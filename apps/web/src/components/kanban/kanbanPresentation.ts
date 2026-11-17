import {
  KANBAN_COLUMNS,
  KANBAN_PRIORITIES,
  type EnvironmentId,
  type KanbanCardId,
  type KanbanColumn,
  type KanbanPriority,
  type KanbanTag,
  KanbanTag as KanbanTagSchema,
  type ProjectId,
} from "@t3tools/contracts";
import type { KanbanCardLiveAttention } from "@t3tools/client-runtime/state/kanban";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export interface KanbanRouteSearch {
  readonly projectId?: ProjectId;
  readonly environmentId?: EnvironmentId;
  readonly cardId?: KanbanCardId;
  readonly q?: string;
  readonly priority?: KanbanPriority;
  readonly tag?: string;
  readonly archived?: boolean;
}

export const COLUMN_LABELS: Readonly<Record<KanbanColumn, string>> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

export const COLUMN_DOT_CLASSES: Readonly<Record<KanbanColumn, string>> = {
  backlog: "bg-muted-foreground/50",
  todo: "bg-foreground/70",
  in_progress: "bg-info",
  review: "bg-warning",
  done: "bg-success",
};

export const PRIORITY_LABELS: Readonly<Record<KanbanPriority, string>> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const PRIORITY_BADGE_VARIANTS: Readonly<
  Record<KanbanPriority, "error" | "warning" | "info" | "outline">
> = {
  urgent: "error",
  high: "warning",
  medium: "info",
  low: "outline",
};

export function attentionBadgePresentation(attention: KanbanCardLiveAttention): {
  readonly label: string;
  readonly variant: "error" | "warning" | "info" | "success" | "outline";
} | null {
  switch (attention.kind) {
    case "question_pending":
      return { label: "Needs input", variant: "warning" };
    case "approval_required":
      return { label: "Needs approval", variant: "warning" };
    case "failed":
      return { label: "Failed", variant: "error" };
    case "running":
      return { label: "Running", variant: "info" };
    case "completed":
      return { label: "Completed", variant: "success" };
    case "idle":
      return null;
  }
}

const decodeTag = Schema.decodeUnknownOption(KanbanTagSchema);

export function parseTagsInput(raw: string): ReadonlyArray<KanbanTag> {
  const seen = new Set<string>();
  const tags: Array<KanbanTag> = [];
  for (const part of raw.split(",")) {
    const decoded = decodeTag(part);
    if (Option.isNone(decoded)) continue;
    const key = decoded.value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(decoded.value);
    if (tags.length >= 20) break;
  }
  return tags;
}

export function isValidKanbanColumn(value: unknown): value is KanbanColumn {
  return typeof value === "string" && (KANBAN_COLUMNS as readonly string[]).includes(value);
}

export function isValidKanbanPriority(value: unknown): value is KanbanPriority {
  return typeof value === "string" && (KANBAN_PRIORITIES as readonly string[]).includes(value);
}
