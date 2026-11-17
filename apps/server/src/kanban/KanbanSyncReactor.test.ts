import { expect, it } from "@effect/vitest";
import {
  KanbanCardId,
  ProjectId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type KanbanCard,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as KanbanService from "./KanbanService.ts";
import * as KanbanSyncReactor from "./KanbanSyncReactor.ts";

const threadId = ThreadId.make("thread:sync-1");
const cardId = KanbanCardId.make("card:sync-1");
const projId = ProjectId.make("project:sync");

function makeCard(column: KanbanCard["column"]): KanbanCard {
  return {
    id: cardId,
    projectId: projId,
    title: "Sync card" as KanbanCard["title"],
    description: "" as KanbanCard["description"],
    column,
    position: 1024,
    priority: "medium",
    tags: [],
    threadId,
    archivedAt: null,
    createdAt: "2026-11-17T00:00:00.000Z",
    updatedAt: "2026-11-17T00:00:00.000Z",
  };
}

function makeShell(overrides: Partial<OrchestrationV2ThreadShell>): OrchestrationV2ThreadShell {
  return {
    id: threadId,
    projectId: projId,
    title: "Sync thread",
    status: "running",
    activeRunId: RunId.make("run-1"),
    latestRunId: RunId.make("run-1"),
    pendingRuntimeRequest: null,
    pullRequests: [],
    linkedPullRequest: null,
    branchPullRequest: null,
    deletedAt: null,
    archivedAt: null,
    ...overrides,
  } as unknown as OrchestrationV2ThreadShell;
}

it.effect(
  "moves In Progress cards to Review on clean completion, stays put when blocked/failed, moves to Done on merged PR, and unlinks on delete",
  () =>
    Effect.gen(function* () {
      const eventsPubSub = yield* PubSub.unbounded<OrchestrationV2DomainEvent>();
      const cardRef = yield* Ref.make<KanbanCard | null>(makeCard("in_progress"));
      const shellRef = yield* Ref.make<OrchestrationV2ThreadShell | null>(makeShell({}));

      const layer = KanbanSyncReactor.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(Orchestrator.OrchestratorV2)({
              streamDomainEvents: Stream.fromPubSub(eventsPubSub),
            }),
            Layer.mock(ThreadManagementService.ThreadManagementService)({
              getThreadShell: (id) => (id === threadId ? Ref.get(shellRef) : Effect.succeed(null)),
            }),
            Layer.mock(KanbanService.KanbanService)({
              getByThreadId: (id) =>
                Ref.get(cardRef).pipe(
                  Effect.map((c) => (c !== null && c.threadId === id ? [c] : [])),
                ),
              syncCardColumnFromLifecycle: ({ expectedColumns, targetColumn }) =>
                Ref.modify(cardRef, (current) => {
                  if (!current || !expectedColumns.includes(current.column)) {
                    return [false, current];
                  }
                  return [true, { ...current, column: targetColumn }];
                }),
              unlinkDeletedThread: (id) =>
                Ref.update(cardRef, (current) =>
                  current && current.threadId === id ? { ...current, threadId: null } : current,
                ),
            }),
          ),
        ),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const reactor = yield* KanbanSyncReactor.KanbanSyncReactor;
          yield* reactor.start();
          yield* Effect.yieldNow;

          // 1. Blocked on pending user_input -> stays in_progress
          yield* Ref.set(
            shellRef,
            makeShell({
              status: "completed",
              activeRunId: null,
              pendingRuntimeRequest: {
                id: RuntimeRequestId.make("req-1"),
                kind: "user_input",
                blocking: true,
              } as never,
            }),
          );
          yield* reactor.evaluateThread(threadId);
          yield* reactor.drain;
          expect((yield* Ref.get(cardRef))?.column).toBe("in_progress");

          // 2. Failed run -> stays in_progress
          yield* Ref.set(
            shellRef,
            makeShell({
              status: "failed",
              activeRunId: null,
              pendingRuntimeRequest: null,
            }),
          );
          yield* reactor.evaluateThread(threadId);
          yield* reactor.drain;
          expect((yield* Ref.get(cardRef))?.column).toBe("in_progress");

          // 3. Cleanly completed run -> moves to review
          yield* Ref.set(
            shellRef,
            makeShell({
              status: "completed",
              activeRunId: null,
              pendingRuntimeRequest: null,
            }),
          );
          yield* PubSub.publish(eventsPubSub, {
            type: "run.updated",
            threadId,
            payload: { status: "completed" },
          } as unknown as OrchestrationV2DomainEvent);
          yield* Effect.yieldNow;
          yield* reactor.drain;
          expect((yield* Ref.get(cardRef))?.column).toBe("review");

          // 4. Linked PR merged -> moves to done
          yield* Ref.set(
            shellRef,
            makeShell({
              status: "completed",
              activeRunId: null,
              pullRequests: [
                {
                  url: "https://github.com/org/repo/pull/10",
                  unlinkedAt: null,
                  snapshot: {
                    number: 10,
                    title: "Ship Kanban",
                    state: "merged",
                  },
                } as never,
              ],
            }),
          );
          yield* PubSub.publish(eventsPubSub, {
            type: "thread.pull-request-synced",
            threadId,
          } as unknown as OrchestrationV2DomainEvent);
          yield* Effect.yieldNow;
          yield* reactor.drain;
          expect((yield* Ref.get(cardRef))?.column).toBe("done");

          // 5. Thread deleted -> unlinks threadId while preserving card in done
          yield* PubSub.publish(eventsPubSub, {
            type: "thread.deleted",
            threadId,
          } as unknown as OrchestrationV2DomainEvent);
          yield* Effect.yieldNow;
          yield* reactor.drain;
          const afterDelete = yield* Ref.get(cardRef);
          expect(afterDelete?.column).toBe("done");
          expect(afterDelete?.threadId).toBeNull();
        }),
      ).pipe(Effect.provide(layer));
    }),
);
