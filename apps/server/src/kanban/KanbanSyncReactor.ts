import type { KanbanCard, ThreadId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../serverActivation.ts";
import * as KanbanService from "./KanbanService.ts";

type ReactorEvent =
  | { readonly kind: "evaluate_thread"; readonly threadId: ThreadId }
  | { readonly kind: "thread_deleted"; readonly threadId: ThreadId };

export class KanbanSyncReactor extends Context.Service<
  KanbanSyncReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
    readonly evaluateThread: (threadId: ThreadId) => Effect.Effect<void>;
  }
>()("t3/kanban/KanbanSyncReactor") {}

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const kanban = yield* KanbanService.KanbanService;

  const evaluateThreadNow = Effect.fn("KanbanSyncReactor.evaluateThreadNow")(function* (
    threadId: ThreadId,
  ) {
    const cards = yield* kanban
      .getByThreadId(threadId)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<KanbanCard> => []));
    if (cards.length === 0) return;

    const shell = yield* threadManagement
      .getThreadShell(threadId)
      .pipe(Effect.orElseSucceed(() => null));
    if (shell === null || shell.deletedAt !== null) {
      yield* kanban.unlinkDeletedThread(threadId).pipe(Effect.ignore);
      return;
    }

    const visibleLinks = visibleThreadPullRequests(shell.pullRequests ?? []);
    const hasMergedPr = visibleLinks.some((link) => link.snapshot?.state === "merged");

    if (hasMergedPr) {
      for (const card of cards) {
        if (card.column === "in_progress" || card.column === "review") {
          yield* kanban
            .syncCardColumnFromLifecycle({
              cardId: card.id,
              expectedColumns: ["in_progress", "review"],
              targetColumn: "done",
            })
            .pipe(Effect.ignore);
        }
      }
      return;
    }

    const isBlockedOrActive =
      shell.activeRunId !== null ||
      (shell.pendingRuntimeRequest !== null && shell.pendingRuntimeRequest.blocking !== false) ||
      shell.status === "failed" ||
      shell.status === "interrupted" ||
      shell.status === "cancelled";

    if (isBlockedOrActive) return;

    const hasOpenPr =
      visibleLinks.some((link) => link.snapshot === null || link.snapshot.state === "open") ||
      shell.linkedPullRequest != null ||
      shell.branchPullRequest != null;
    const completedCleanly = shell.status === "completed" && shell.latestRunId !== null;

    if (completedCleanly || hasOpenPr) {
      for (const card of cards) {
        if (card.column === "in_progress") {
          yield* kanban
            .syncCardColumnFromLifecycle({
              cardId: card.id,
              expectedColumns: ["in_progress"],
              targetColumn: "review",
            })
            .pipe(Effect.ignore);
        }
      }
    }
  });

  const worker = yield* makeDrainableWorker<ReactorEvent, never, never>((item) =>
    item.kind === "thread_deleted"
      ? kanban.unlinkDeletedThread(item.threadId).pipe(Effect.ignore)
      : evaluateThreadNow(item.threadId),
  );

  const start: KanbanSyncReactor["Service"]["start"] = Effect.fn("KanbanSyncReactor.start")(
    function* () {
      yield* forkParked(
        Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
          switch (event.type) {
            case "thread.deleted":
              return worker.enqueue({ kind: "thread_deleted", threadId: event.threadId });
            case "run.updated":
              return event.payload.status === "completed"
                ? worker.enqueue({ kind: "evaluate_thread", threadId: event.threadId })
                : Effect.void;
            case "thread.pull-request-link-updated":
            case "thread.pull-request-synced":
            case "thread.settled":
              return worker.enqueue({ kind: "evaluate_thread", threadId: event.threadId });
            default:
              return Effect.void;
          }
        }).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : Effect.logWarning("kanban sync reactor stream failed", { cause }),
          ),
        ),
      );
    },
  );

  const evaluateThread = Effect.fn("KanbanSyncReactor.evaluateThread")((threadId: ThreadId) =>
    worker.enqueue({ kind: "evaluate_thread", threadId }),
  );

  return KanbanSyncReactor.of({
    start,
    drain: worker.drain,
    evaluateThread,
  });
});

export const layer = Layer.effect(KanbanSyncReactor, make);
