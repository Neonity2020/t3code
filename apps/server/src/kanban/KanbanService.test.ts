import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  KanbanError,
  KanbanTag,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerSettings as ServerSettingsContract,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as KanbanService from "./KanbanService.ts";

const projId = ProjectId.make("project:kanban-test");
const otherProjId = ProjectId.make("project:other");

interface LaunchRecord {
  readonly prompt: string;
  readonly workspaceStrategy: { readonly type: string };
  readonly projectId: ProjectId;
}

interface SendRecord {
  readonly threadId: ThreadId;
  readonly prompt: string;
}

function makeTestEnv(options?: {
  readonly initialSettings?: ServerSettingsContract;
  readonly isGitRepo?: boolean;
}) {
  return Effect.gen(function* () {
    const settingsRef = yield* Ref.make<ServerSettingsContract>(
      options?.initialSettings ?? DEFAULT_SERVER_SETTINGS,
    );
    const launchesRef = yield* Ref.make<ReadonlyArray<LaunchRecord>>([]);
    const sendsRef = yield* Ref.make<ReadonlyArray<SendRecord>>([]);
    const shellsRef = yield* Ref.make<
      Map<ThreadId, { projectId: ProjectId; deletedAt: string | null }>
    >(new Map());

    const layer = KanbanService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          NodeCrypto.layer,
          Layer.mock(ServerSettings.ServerSettingsService)({
            getSettings: Ref.get(settingsRef),
          }),
          Layer.mock(ProjectService.ProjectService)({
            getShell: (id) =>
              Effect.succeed(
                id === projId || id === otherProjId
                  ? Option.some({
                      id,
                      title: "Test Project",
                      workspaceRoot: "/tmp/test-project",
                      defaultModelSelection: {
                        instanceId: ProviderInstanceId.make("codex"),
                        model: "gpt-5.4",
                      },
                      scripts: [],
                      deletedAt: null,
                    } as never)
                  : Option.none(),
              ),
          }),
          Layer.mock(ProviderRegistry.ProviderRegistry)({
            getProviders: Effect.succeed([
              {
                instanceId: ProviderInstanceId.make("codex"),
                driverKind: ProviderDriverKind.make("codex"),
                enabled: true,
                status: "ready",
                models: [{ slug: "gpt-5.4", name: "GPT-5.4", isCustom: false }],
              } as never,
            ]),
          }),
          Layer.mock(GitVcsDriver.GitVcsDriver)({
            listRefs: () =>
              Effect.succeed({
                isRepo: options?.isGitRepo !== false,
                refs: [],
              } as never),
          }),
          Layer.mock(ThreadLaunchService.ThreadLaunchService)({
            launch: (input) =>
              Effect.gen(function* () {
                const prev = yield* Ref.get(launchesRef);
                const launchedId = ThreadId.make(`thread:launched-${prev.length + 1}`);
                yield* Ref.set(launchesRef, [
                  ...prev,
                  {
                    prompt: input.initialMessage?.text ?? "",
                    workspaceStrategy: input.workspaceStrategy,
                    projectId: input.projectId,
                  },
                ]);
                const shells = yield* Ref.get(shellsRef);
                const nextShells = new Map(shells);
                nextShells.set(launchedId, { projectId: input.projectId, deletedAt: null });
                yield* Ref.set(shellsRef, nextShells);
                return { threadId: launchedId, resumed: false } as never;
              }),
          }),
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getThreadShell: (id) =>
              Effect.gen(function* () {
                const shells = yield* Ref.get(shellsRef);
                const entry = shells.get(id);
                return entry ? (entry as never) : null;
              }),
            sendToThread: (input) =>
              Effect.gen(function* () {
                const prev = yield* Ref.get(sendsRef);
                yield* Ref.set(sendsRef, [
                  ...prev,
                  { threadId: input.threadId, prompt: input.text },
                ]);
                return undefined as never;
              }),
          }),
        ),
      ),
    );

    return { layer, settingsRef, launchesRef, sendsRef, shellsRef };
  });
}

it.effect(
  "manages card CRUD, column positioning, archive, and delete without touching bound threads",
  () =>
    Effect.gen(function* () {
      const env = yield* makeTestEnv();
      yield* Effect.gen(function* () {
        const kanban = yield* KanbanService.KanbanService;

        const first = yield* kanban.createCard({
          projectId: projId,
          title: "First task",
          description: "Write contracts",
          column: "todo",
          priority: "high",
          tags: [KanbanTag.make("contracts")],
        });
        const second = yield* kanban.createCard({
          projectId: projId,
          title: "Second task",
          column: "todo",
        });
        expect(first.card.position).toBeLessThan(second.card.position);

        const reordered = yield* kanban.moveCard({
          id: second.card.id,
          column: "todo",
          beforeCardId: first.card.id,
        });
        expect(reordered.card.position).toBeLessThan(first.card.position);

        const movedDone = yield* kanban.moveCard({
          id: second.card.id,
          column: "done",
        });
        expect(movedDone.card.column).toBe("done");

        const archivedBatch = yield* kanban.archiveDone({ projectId: projId });
        expect(archivedBatch.archivedCount).toBe(1);

        const activeList = yield* kanban.list({ projectId: projId });
        expect(activeList.cards.map((c) => c.id)).toEqual([first.card.id]);

        const restored = yield* kanban.setArchived({ id: second.card.id, archived: false });
        expect(restored.card.archivedAt).toBeNull();

        yield* kanban.deleteCard({ id: first.card.id });
        const remaining = yield* kanban.list({ projectId: projId });
        expect(remaining.cards.map((c) => c.id)).toEqual([second.card.id]);
      }).pipe(Effect.provide(env.layer));
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect(
  "auto-launches an isolated worktree thread on In Progress and sends rework feedback to the same thread",
  () =>
    Effect.gen(function* () {
      const env = yield* makeTestEnv({ isGitRepo: true });
      yield* Effect.gen(function* () {
        const kanban = yield* KanbanService.KanbanService;

        const { card } = yield* kanban.createCard({
          projectId: projId,
          title: "Implement OAuth refresh",
          description: "Ensure refresh tokens rotate cleanly.",
          column: "todo",
        });

        const started = yield* kanban.moveCard({
          id: card.id,
          column: "in_progress",
          autoStart: true,
        });
        expect(started.launchedThreadId).toBe("thread:launched-1");
        expect(started.card.threadId).toBe("thread:launched-1");
        expect(started.card.column).toBe("in_progress");

        const launches = yield* Ref.get(env.launchesRef);
        expect(launches).toMatchObject([
          {
            projectId: projId,
            prompt: "# Implement OAuth refresh\n\nEnsure refresh tokens rotate cleanly.",
            workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
          },
        ]);

        yield* kanban.moveCard({ id: card.id, column: "review" });

        const reworked = yield* kanban.moveCard({
          id: card.id,
          column: "in_progress",
          reworkFeedback: "Please also handle 401 retry race conditions.",
        });
        expect(reworked.launchedThreadId).toBeNull();
        expect(reworked.card.threadId).toBe("thread:launched-1");
        expect(yield* Ref.get(env.launchesRef)).toHaveLength(1);
        expect(yield* Ref.get(env.sendsRef)).toEqual([
          {
            threadId: ThreadId.make("thread:launched-1"),
            prompt: "Please also handle 401 retry race conditions.",
          },
        ]);
      }).pipe(Effect.provide(env.layer));
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("enforces environment and project-level kanbanPluginEnabled settings", () =>
  Effect.gen(function* () {
    const env = yield* makeTestEnv({
      initialSettings: {
        ...DEFAULT_SERVER_SETTINGS,
        kanbanPluginEnabled: true,
        projectSettingsOverrides: {
          [projId]: { kanbanPluginEnabled: false },
        },
      },
    });
    yield* Effect.gen(function* () {
      const kanban = yield* KanbanService.KanbanService;

      const err = yield* kanban
        .createCard({ projectId: projId, title: "Blocked" })
        .pipe(Effect.flip);
      expect(err).toBeInstanceOf(KanbanError);
      expect(err.code).toBe("plugin_disabled");

      const allowed = yield* kanban.createCard({
        projectId: otherProjId,
        title: "Allowed in other project",
      });
      expect(allowed.card.projectId).toBe(otherProjId);
    }).pipe(Effect.provide(env.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
