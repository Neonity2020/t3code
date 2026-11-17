import type { EnvironmentId, KanbanCardId, ProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { KanbanBoardPage } from "../components/kanban/KanbanBoardPage";
import {
  isValidKanbanPriority,
  type KanbanRouteSearch,
} from "../components/kanban/kanbanPresentation";

export const Route = createFileRoute("/_chat/kanban")({
  validateSearch: (raw: Record<string, unknown>): KanbanRouteSearch => ({
    ...(typeof raw.projectId === "string" && raw.projectId
      ? { projectId: raw.projectId as ProjectId }
      : {}),
    ...(typeof raw.environmentId === "string" && raw.environmentId
      ? { environmentId: raw.environmentId as EnvironmentId }
      : {}),
    ...(typeof raw.cardId === "string" && raw.cardId ? { cardId: raw.cardId as KanbanCardId } : {}),
    ...(typeof raw.q === "string" && raw.q ? { q: raw.q.slice(0, 200) } : {}),
    ...(isValidKanbanPriority(raw.priority) ? { priority: raw.priority } : {}),
    ...(typeof raw.tag === "string" && raw.tag ? { tag: raw.tag.slice(0, 64) } : {}),
    ...(raw.archived === true || raw.archived === "true" ? { archived: true } : {}),
  }),
  component: KanbanBoardPage,
});
