import {
  KANBAN_COLUMNS,
  type EnvironmentId,
  type KanbanCard,
  type KanbanCardId,
  type KanbanColumn,
  type KanbanPriority,
  type ProjectId,
  type PullRequestState,
  type ServerSettings,
  type ThreadId,
  resolveBuiltinPluginEnabled,
} from "@t3tools/contracts";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";

import { type EnvironmentThreadShell, threadRuntimeIsActive } from "./models.ts";

export interface ScopedKanbanCard {
  readonly environmentId: EnvironmentId;
  readonly card: KanbanCard;
}

export interface KanbanFilterState {
  readonly projectId?: ProjectId | null;
  readonly environmentId?: EnvironmentId | null;
  readonly query?: string;
  readonly priority?: KanbanPriority | null;
  readonly tag?: string | null;
  readonly showArchived?: boolean;
}

export type KanbanCardLiveAttention =
  | { readonly kind: "approval_required" }
  | { readonly kind: "question_pending" }
  | { readonly kind: "failed"; readonly message?: string | null }
  | { readonly kind: "running" }
  | { readonly kind: "completed" }
  | { readonly kind: "idle" };

export interface KanbanCardThreadStatus {
  readonly threadTitle: string;
  readonly attention: KanbanCardLiveAttention;
  readonly pullRequest: {
    readonly number: number;
    readonly url: string;
    readonly state: PullRequestState | "open";
  } | null;
}

export function deriveKanbanCardThreadStatus(
  thread: Pick<
    EnvironmentThreadShell,
    | "title"
    | "runtime"
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "pullRequests"
    | "linkedPullRequest"
  > | null,
): KanbanCardThreadStatus | null {
  if (thread === null) return null;

  const visiblePrs = visibleThreadPullRequests(thread.pullRequests ?? []);
  const primaryPrLink =
    visiblePrs.find((link) => link.snapshot?.state === "open") ??
    visiblePrs.find((link) => link.snapshot?.state === "merged") ??
    visiblePrs[0];

  const pullRequest =
    primaryPrLink !== undefined
      ? {
          number: primaryPrLink.number,
          url: primaryPrLink.url,
          state: primaryPrLink.snapshot?.state ?? ("open" as const),
        }
      : thread.linkedPullRequest != null
        ? {
            number: thread.linkedPullRequest.number,
            url: thread.linkedPullRequest.url,
            state: "open" as const,
          }
        : null;

  let attention: KanbanCardLiveAttention;
  if (thread.hasPendingUserInput) {
    attention = { kind: "question_pending" };
  } else if (thread.hasPendingApprovals) {
    attention = { kind: "approval_required" };
  } else if (thread.runtime?.status === "failed") {
    attention = { kind: "failed", message: thread.runtime.lastError };
  } else if (threadRuntimeIsActive(thread.runtime)) {
    attention = { kind: "running" };
  } else if (thread.runtime?.status === "completed") {
    attention = { kind: "completed" };
  } else {
    attention = { kind: "idle" };
  }

  return {
    threadTitle: thread.title,
    attention,
    pullRequest,
  };
}

export function filterAndGroupKanbanCards(
  scopedCards: ReadonlyArray<ScopedKanbanCard>,
  filter: KanbanFilterState,
  settingsByEnvironmentId?: ReadonlyMap<
    EnvironmentId,
    Pick<ServerSettings, "kanbanPluginEnabled" | "projectSettingsOverrides">
  >,
): {
  readonly byColumn: Readonly<Record<KanbanColumn, ReadonlyArray<ScopedKanbanCard>>>;
  readonly allTags: ReadonlyArray<string>;
  readonly archivedCount: number;
  readonly doneActiveCount: number;
} {
  const byColumn: Record<KanbanColumn, Array<ScopedKanbanCard>> = {
    backlog: [],
    todo: [],
    in_progress: [],
    review: [],
    done: [],
  };
  const tagMap = new Map<string, string>();
  let archivedCount = 0;
  let doneActiveCount = 0;

  const normalizedQuery = filter.query?.trim().toLowerCase() ?? "";
  const normalizedTag = filter.tag?.trim().toLowerCase() ?? null;
  const showArchived = filter.showArchived === true;

  for (const item of scopedCards) {
    const { environmentId, card } = item;
    if (filter.environmentId != null && environmentId !== filter.environmentId) continue;
    if (filter.projectId != null && card.projectId !== filter.projectId) continue;

    const envSettings = settingsByEnvironmentId?.get(environmentId);
    if (envSettings && !resolveBuiltinPluginEnabled(envSettings, "kanban", card.projectId)) {
      continue;
    }

    for (const tag of card.tags) {
      const lower = tag.toLowerCase();
      if (!tagMap.has(lower)) tagMap.set(lower, tag);
    }

    if (card.archivedAt !== null) {
      archivedCount += 1;
      if (!showArchived) continue;
    } else if (showArchived) {
      continue;
    } else if (card.column === "done") {
      doneActiveCount += 1;
    }

    if (filter.priority != null && card.priority !== filter.priority) continue;
    if (normalizedTag !== null && !card.tags.some((t) => t.toLowerCase() === normalizedTag)) {
      continue;
    }
    if (normalizedQuery.length > 0) {
      const matchesTitle = card.title.toLowerCase().includes(normalizedQuery);
      const matchesDesc = card.description.toLowerCase().includes(normalizedQuery);
      const matchesTag = card.tags.some((t) => t.toLowerCase().includes(normalizedQuery));
      if (!matchesTitle && !matchesDesc && !matchesTag) continue;
    }

    byColumn[card.column].push(item);
  }

  for (const column of KANBAN_COLUMNS) {
    byColumn[column].sort((left, right) => {
      if (left.card.position !== right.card.position) {
        return left.card.position - right.card.position;
      }
      return left.card.createdAt.localeCompare(right.card.createdAt);
    });
  }

  const allTags = [...tagMap.values()].sort((a, b) => a.localeCompare(b));
  return { byColumn, allTags, archivedCount, doneActiveCount };
}

export function buildThreadToKanbanCardIndex(
  cards: ReadonlyArray<KanbanCard>,
): ReadonlyMap<ThreadId, KanbanCard> {
  const index = new Map<ThreadId, KanbanCard>();
  for (const card of cards) {
    if (card.threadId === null || card.archivedAt !== null) continue;
    const existing = index.get(card.threadId);
    if (existing === undefined || card.updatedAt > existing.updatedAt) {
      index.set(card.threadId, card);
    }
  }
  return index;
}

export function resolveDropBeforeCardId(
  columnCards: ReadonlyArray<ScopedKanbanCard>,
  draggedCardId: KanbanCardId,
  overCardId: KanbanCardId | null,
): KanbanCardId | null {
  if (overCardId === null || overCardId === draggedCardId) return null;
  const draggedIndex = columnCards.findIndex((entry) => entry.card.id === draggedCardId);
  const overIndex = columnCards.findIndex((entry) => entry.card.id === overCardId);
  if (overIndex === -1) return null;
  if (draggedIndex !== -1 && draggedIndex < overIndex) {
    return columnCards[overIndex + 1]?.card.id ?? null;
  }
  return columnCards[overIndex]?.card.id ?? null;
}
