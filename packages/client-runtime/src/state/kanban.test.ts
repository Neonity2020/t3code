import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  KanbanCardId,
  KanbanTag,
  ProjectId,
  ThreadId,
  type KanbanCard,
  type ServerSettings,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "./models.ts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadToKanbanCardIndex,
  deriveKanbanCardThreadStatus,
  filterAndGroupKanbanCards,
  resolveDropBeforeCardId,
  type ScopedKanbanCard,
} from "./kanban.ts";

const envA = EnvironmentId.make("env-a");
const envB = EnvironmentId.make("env-b");
const proj1 = ProjectId.make("proj-1");
const proj2 = ProjectId.make("proj-2");

function makeCard(
  overrides: Omit<Partial<KanbanCard>, "id"> & { readonly id: string },
): KanbanCard {
  const { id, ...rest } = overrides;
  return {
    id: KanbanCardId.make(id),
    projectId: proj1,
    title: `Card ${id}` as KanbanCard["title"],
    description: "" as KanbanCard["description"],
    column: "backlog",
    position: 1000,
    priority: "medium",
    tags: [],
    threadId: null,
    archivedAt: null,
    createdAt: "2026-11-17T00:00:00.000Z",
    updatedAt: "2026-11-17T00:00:00.000Z",
    ...rest,
  };
}

function makeShell(overrides: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  return {
    id: ThreadId.make("thread-1"),
    environmentId: envA,
    projectId: proj1,
    title: "Implement feature",
    hasCustomTitle: false,
    branch: "feat/kanban",
    worktreePath: "/tmp/wt",
    runtime: {
      status: "idle",
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-11-17T00:00:00.000Z",
    },
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pullRequests: [],
    linkedPullRequest: null,
    deletedAt: null,
    archivedAt: null,
    lineage: {
      parentThreadId: null,
      rootThreadId: ThreadId.make("thread-1"),
      relationshipToParent: null,
    },
    ...overrides,
  } as unknown as EnvironmentThreadShell;
}

describe("deriveKanbanCardThreadStatus", () => {
  it("prioritizes pending user input, pending approval, active run, and failure badges", () => {
    expect(deriveKanbanCardThreadStatus(null)).toBeNull();

    expect(
      deriveKanbanCardThreadStatus(makeShell({ hasPendingUserInput: true }))?.attention,
    ).toEqual({ kind: "question_pending" });

    expect(
      deriveKanbanCardThreadStatus(makeShell({ hasPendingApprovals: true }))?.attention,
    ).toEqual({ kind: "approval_required" });

    expect(
      deriveKanbanCardThreadStatus(
        makeShell({
          runtime: {
            status: "running",
            activeTurnId: null,
            lastError: null,
            updatedAt: "2026-11-17T00:00:00.000Z",
          } as never,
        }),
      )?.attention,
    ).toEqual({ kind: "running" });

    const failed = deriveKanbanCardThreadStatus(
      makeShell({
        runtime: {
          status: "failed",
          activeTurnId: null,
          lastError: "Provider crashed",
          updatedAt: "2026-11-17T00:00:00.000Z",
        } as never,
        linkedPullRequest: {
          number: 42,
          url: "https://github.com/org/repo/pull/42",
        } as never,
      }),
    );
    expect(failed?.attention).toEqual({ kind: "failed", message: "Provider crashed" });
    expect(failed?.pullRequest).toEqual({
      number: 42,
      url: "https://github.com/org/repo/pull/42",
      state: "open",
    });
  });
});

describe("filterAndGroupKanbanCards", () => {
  it("filters by plugin enablement overrides, search, priority, tag, and archive state", () => {
    const cards: ReadonlyArray<ScopedKanbanCard> = [
      {
        environmentId: envA,
        card: makeCard({
          id: "c-2",
          column: "todo",
          position: 2000,
          priority: "high",
          tags: [KanbanTag.make("ui"), KanbanTag.make("auth")],
          title: "Second todo" as KanbanCard["title"],
        }),
      },
      {
        environmentId: envA,
        card: makeCard({
          id: "c-1",
          column: "todo",
          position: 1000,
          priority: "urgent",
          tags: [KanbanTag.make("ui")],
          title: "First todo" as KanbanCard["title"],
        }),
      },
      {
        environmentId: envA,
        card: makeCard({
          id: "c-done",
          column: "done",
          position: 1000,
          title: "Completed task" as KanbanCard["title"],
        }),
      },
      {
        environmentId: envA,
        card: makeCard({
          id: "c-arch",
          column: "done",
          position: 2000,
          archivedAt: "2026-11-17T01:00:00.000Z",
        }),
      },
      {
        environmentId: envB,
        card: makeCard({
          id: "c-disabled-proj",
          projectId: proj2,
          column: "backlog",
        }),
      },
    ];

    const settingsByEnv = new Map<EnvironmentId, ServerSettings>([
      [envA, DEFAULT_SERVER_SETTINGS],
      [
        envB,
        {
          ...DEFAULT_SERVER_SETTINGS,
          projectSettingsOverrides: {
            [proj2]: { kanbanPluginEnabled: false },
          },
        },
      ],
    ]);

    const grouped = filterAndGroupKanbanCards(
      cards,
      {
        projectId: null,
        environmentId: null,
        query: "",
        priority: null,
        tag: null,
        showArchived: false,
      },
      settingsByEnv,
    );

    expect(grouped.byColumn.backlog).toHaveLength(0);
    expect(grouped.byColumn.todo.map((c) => c.card.id)).toEqual(["c-1", "c-2"]);
    expect(grouped.doneActiveCount).toBe(1);
    expect(grouped.archivedCount).toBe(1);
    expect(grouped.allTags).toEqual(["auth", "ui"]);

    const filteredByTagAndQuery = filterAndGroupKanbanCards(
      cards,
      {
        projectId: proj1,
        environmentId: envA,
        query: "second",
        priority: "high",
        tag: "auth",
        showArchived: false,
      },
      settingsByEnv,
    );
    expect(filteredByTagAndQuery.byColumn.todo).toHaveLength(1);
    expect(filteredByTagAndQuery.byColumn.todo[0]?.card.id).toBe("c-2");

    const archivedOnly = filterAndGroupKanbanCards(
      cards,
      {
        projectId: null,
        environmentId: null,
        query: "",
        priority: null,
        tag: null,
        showArchived: true,
      },
      settingsByEnv,
    );
    expect(archivedOnly.byColumn.done).toHaveLength(1);
    expect(archivedOnly.byColumn.done[0]?.card.id).toBe("c-arch");
  });
});

describe("buildThreadToKanbanCardIndex & resolveDropBeforeCardId", () => {
  it("indexes bound threads preferring active cards over archived cards", () => {
    const t1 = ThreadId.make("t-1");
    const archived = makeCard({
      id: "old",
      threadId: t1,
      archivedAt: "2026-11-17T00:00:00.000Z",
    });
    const active = makeCard({
      id: "current",
      threadId: t1,
      archivedAt: null,
    });
    const index = buildThreadToKanbanCardIndex([archived, active]);
    expect(index.get(t1)?.id).toBe("current");
  });

  it("computes beforeCardId when reordering down, reordering up, or dropping across columns", () => {
    const col: ReadonlyArray<ScopedKanbanCard> = [
      { environmentId: envA, card: makeCard({ id: "a", position: 1000 }) },
      { environmentId: envA, card: makeCard({ id: "b", position: 2000 }) },
      { environmentId: envA, card: makeCard({ id: "c", position: 3000 }) },
    ];

    expect(resolveDropBeforeCardId(col, KanbanCardId.make("a"), KanbanCardId.make("b"))).toBe(
      KanbanCardId.make("c"),
    );
    expect(resolveDropBeforeCardId(col, KanbanCardId.make("a"), KanbanCardId.make("c"))).toBeNull();
    expect(resolveDropBeforeCardId(col, KanbanCardId.make("c"), KanbanCardId.make("a"))).toBe(
      KanbanCardId.make("a"),
    );
    expect(
      resolveDropBeforeCardId(col, KanbanCardId.make("from-other-col"), KanbanCardId.make("b")),
    ).toBe(KanbanCardId.make("b"));
  });
});
