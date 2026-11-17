import {
  KANBAN_CARD_DESCRIPTION_MAX_LENGTH,
  KANBAN_CARD_MAX_TAGS,
  KANBAN_CARD_TITLE_MAX_LENGTH,
  KanbanCard,
  KanbanCardId,
  KanbanColumn,
  KanbanPriority,
  KanbanTag,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  ProjectId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as KanbanService from "../../../kanban/KanbanService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  KanbanService.KanbanService,
];

const KanbanCardSummary = Schema.Struct({
  id: KanbanCard.fields.id,
  projectId: KanbanCard.fields.projectId,
  title: KanbanCard.fields.title,
  column: KanbanCard.fields.column,
  priority: KanbanCard.fields.priority,
  tags: KanbanCard.fields.tags,
  threadId: KanbanCard.fields.threadId,
  archivedAt: KanbanCard.fields.archivedAt,
  updatedAt: KanbanCard.fields.updatedAt,
});

const KanbanListCardsTool = Tool.make("kanban_list_cards", {
  description:
    "List kanban cards. `projectId` defaults to this thread's project, or all projects outside a thread. Filter by `column`, `tag`, or `includeArchived`.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    projectId: Schema.optional(ProjectId),
    column: Schema.optional(KanbanColumn),
    tag: Schema.optional(KanbanTag),
    includeArchived: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({
    cards: Schema.Array(KanbanCardSummary),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies,
})
  .annotate(Tool.Title, "List kanban cards")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const KanbanGetCardTool = Tool.make("kanban_get_card", {
  description:
    "Read a kanban card's full Markdown description and metadata by `cardId`, or omit `cardId` for the card linked to this thread.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    cardId: Schema.optional(KanbanCardId),
  }),
  success: Schema.Struct({
    card: Schema.NullOr(KanbanCard),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies,
})
  .annotate(Tool.Title, "Read kanban card")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const CreateCardItem = Schema.Struct({
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(KANBAN_CARD_TITLE_MAX_LENGTH)),
  description: Schema.optional(
    TrimmedString.check(Schema.isMaxLength(KANBAN_CARD_DESCRIPTION_MAX_LENGTH)),
  ),
  column: Schema.optional(KanbanColumn),
  priority: Schema.optional(KanbanPriority),
  tags: Schema.optional(Schema.Array(KanbanTag).check(Schema.isMaxLength(KANBAN_CARD_MAX_TAGS))),
});

const KanbanCreateCardsTool = Tool.make("kanban_create_cards", {
  description:
    "Create one or more kanban cards (default `backlog`). `projectId` defaults to this thread's project. Set `autoStart` true only to launch `in_progress` cards immediately.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    projectId: Schema.optional(ProjectId),
    cards: Schema.Array(CreateCardItem).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
    autoStart: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({
    cards: Schema.Array(KanbanCard),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies,
})
  .annotate(Tool.Title, "Create kanban cards")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false);

const KanbanUpdateCardTool = Tool.make("kanban_update_card", {
  description:
    "Update a kanban card's fields, `column`, or `archived` state. Omit `cardId` to update the card linked to this thread.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    cardId: Schema.optional(KanbanCardId),
    title: Schema.optional(
      TrimmedNonEmptyString.check(Schema.isMaxLength(KANBAN_CARD_TITLE_MAX_LENGTH)),
    ),
    description: Schema.optional(
      TrimmedString.check(Schema.isMaxLength(KANBAN_CARD_DESCRIPTION_MAX_LENGTH)),
    ),
    priority: Schema.optional(KanbanPriority),
    tags: Schema.optional(Schema.Array(KanbanTag).check(Schema.isMaxLength(KANBAN_CARD_MAX_TAGS))),
    column: Schema.optional(KanbanColumn),
    beforeCardId: Schema.optional(Schema.NullOr(KanbanCardId)),
    archived: Schema.optional(Schema.Boolean),
    autoStart: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({
    card: KanbanCard,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies,
})
  .annotate(Tool.Title, "Update kanban card")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true);

export const KanbanToolkit = Toolkit.make(
  KanbanListCardsTool,
  KanbanGetCardTool,
  KanbanCreateCardsTool,
  KanbanUpdateCardTool,
);

export const KANBAN_MCP_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(KanbanToolkit.tools));
