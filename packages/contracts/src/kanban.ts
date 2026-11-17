import * as Schema from "effect/Schema";

import {
  ForwardCompatibleArray,
  IsoDateTime,
  KanbanCardId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";
import { ThreadEnvMode } from "./environment.ts";
import { ModelSelection } from "./modelSelection.ts";
import { OrchestrationV2Actor, OrchestrationV2CreationSource } from "./orchestrationV2.ts";

export const KANBAN_COLUMNS = ["backlog", "todo", "in_progress", "review", "done"] as const;
export const KanbanColumn = Schema.Literals(KANBAN_COLUMNS);
export type KanbanColumn = typeof KanbanColumn.Type;

export const KANBAN_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export const KanbanPriority = Schema.Literals(KANBAN_PRIORITIES);
export type KanbanPriority = typeof KanbanPriority.Type;

export const KANBAN_CARD_TITLE_MAX_LENGTH = 240;
export const KANBAN_CARD_DESCRIPTION_MAX_LENGTH = 64_000;
const KANBAN_CARD_TAG_MAX_LENGTH = 64;
export const KANBAN_CARD_MAX_TAGS = 20;

export const KanbanTag = TrimmedNonEmptyString.check(
  Schema.isMaxLength(KANBAN_CARD_TAG_MAX_LENGTH),
);
export type KanbanTag = typeof KanbanTag.Type;

export const KanbanLaunchPreset = Schema.Struct({
  modelSelection: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  workspaceMode: Schema.optionalKey(ThreadEnvMode),
});
export type KanbanLaunchPreset = typeof KanbanLaunchPreset.Type;

export const KanbanCard = Schema.Struct({
  id: KanbanCardId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(KANBAN_CARD_TITLE_MAX_LENGTH)),
  description: TrimmedString.check(Schema.isMaxLength(KANBAN_CARD_DESCRIPTION_MAX_LENGTH)),
  column: KanbanColumn,
  position: Schema.Finite,
  priority: KanbanPriority,
  tags: ForwardCompatibleArray(KanbanTag),
  launchPreset: Schema.optionalKey(KanbanLaunchPreset),
  threadId: Schema.NullOr(ThreadId),
  archivedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type KanbanCard = typeof KanbanCard.Type;

export const KanbanListInput = Schema.Struct({
  projectId: Schema.optionalKey(ProjectId),
  includeArchived: Schema.optionalKey(Schema.Boolean),
});
export type KanbanListInput = typeof KanbanListInput.Type;

export const KanbanListResult = Schema.Struct({
  cards: ForwardCompatibleArray(KanbanCard),
});
export type KanbanListResult = typeof KanbanListResult.Type;

export const KanbanSubscribeInput = Schema.Struct({});
export type KanbanSubscribeInput = typeof KanbanSubscribeInput.Type;

export const KanbanCreateCardInput = Schema.Struct({
  id: Schema.optionalKey(KanbanCardId),
  projectId: ProjectId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(KANBAN_CARD_TITLE_MAX_LENGTH)),
  description: Schema.optionalKey(
    TrimmedString.check(Schema.isMaxLength(KANBAN_CARD_DESCRIPTION_MAX_LENGTH)),
  ),
  column: Schema.optionalKey(KanbanColumn),
  priority: Schema.optionalKey(KanbanPriority),
  tags: Schema.optionalKey(Schema.Array(KanbanTag).check(Schema.isMaxLength(KANBAN_CARD_MAX_TAGS))),
  launchPreset: Schema.optionalKey(KanbanLaunchPreset),
  threadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  autoStart: Schema.optionalKey(Schema.Boolean),
  createdBy: Schema.optionalKey(OrchestrationV2Actor),
  creationSource: Schema.optionalKey(OrchestrationV2CreationSource),
});
export type KanbanCreateCardInput = typeof KanbanCreateCardInput.Type;

export const KanbanUpdateCardInput = Schema.Struct({
  id: KanbanCardId,
  title: Schema.optionalKey(
    TrimmedNonEmptyString.check(Schema.isMaxLength(KANBAN_CARD_TITLE_MAX_LENGTH)),
  ),
  description: Schema.optionalKey(
    TrimmedString.check(Schema.isMaxLength(KANBAN_CARD_DESCRIPTION_MAX_LENGTH)),
  ),
  priority: Schema.optionalKey(KanbanPriority),
  tags: Schema.optionalKey(Schema.Array(KanbanTag).check(Schema.isMaxLength(KANBAN_CARD_MAX_TAGS))),
  launchPreset: Schema.optionalKey(Schema.NullOr(KanbanLaunchPreset)),
});
export type KanbanUpdateCardInput = typeof KanbanUpdateCardInput.Type;

export const KanbanMoveCardInput = Schema.Struct({
  id: KanbanCardId,
  column: KanbanColumn,
  beforeCardId: Schema.optionalKey(Schema.NullOr(KanbanCardId)),
  position: Schema.optionalKey(Schema.Finite),
  autoStart: Schema.optionalKey(Schema.Boolean),
  reworkFeedback: Schema.optionalKey(
    TrimmedString.check(Schema.isMaxLength(KANBAN_CARD_DESCRIPTION_MAX_LENGTH)),
  ),
  createdBy: Schema.optionalKey(OrchestrationV2Actor),
  creationSource: Schema.optionalKey(OrchestrationV2CreationSource),
});
export type KanbanMoveCardInput = typeof KanbanMoveCardInput.Type;

export const KanbanStartCardInput = Schema.Struct({
  id: KanbanCardId,
  promptOverride: Schema.optionalKey(
    TrimmedNonEmptyString.check(Schema.isMaxLength(KANBAN_CARD_DESCRIPTION_MAX_LENGTH)),
  ),
  createdBy: Schema.optionalKey(OrchestrationV2Actor),
  creationSource: Schema.optionalKey(OrchestrationV2CreationSource),
});
export type KanbanStartCardInput = typeof KanbanStartCardInput.Type;

export const KanbanLinkThreadInput = Schema.Struct({
  id: KanbanCardId,
  threadId: Schema.NullOr(ThreadId),
});
export type KanbanLinkThreadInput = typeof KanbanLinkThreadInput.Type;

export const KanbanSetArchivedInput = Schema.Struct({
  id: KanbanCardId,
  archived: Schema.Boolean,
});
export type KanbanSetArchivedInput = typeof KanbanSetArchivedInput.Type;

export const KanbanArchiveDoneInput = Schema.Struct({
  projectId: Schema.optionalKey(ProjectId),
});
export type KanbanArchiveDoneInput = typeof KanbanArchiveDoneInput.Type;

export const KanbanDeleteCardInput = Schema.Struct({
  id: KanbanCardId,
});
export type KanbanDeleteCardInput = typeof KanbanDeleteCardInput.Type;

export const KanbanMutationResult = Schema.Struct({
  card: KanbanCard,
  launchedThreadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
});
export type KanbanMutationResult = typeof KanbanMutationResult.Type;

export const KanbanArchiveDoneResult = Schema.Struct({
  archivedCount: NonNegativeInt,
});
export type KanbanArchiveDoneResult = typeof KanbanArchiveDoneResult.Type;

export const KanbanDeleteCardResult = Schema.Struct({
  id: KanbanCardId,
});
export type KanbanDeleteCardResult = typeof KanbanDeleteCardResult.Type;

export const KanbanErrorCode = Schema.Literals([
  "not_found",
  "plugin_disabled",
  "invalid_request",
  "launch_failed",
  "persistence_error",
]);
export type KanbanErrorCode = typeof KanbanErrorCode.Type;

export class KanbanError extends Schema.TaggedError<KanbanError>()("KanbanError", {
  code: KanbanErrorCode,
  message: Schema.String,
  cardId: Schema.optional(KanbanCardId),
  cause: Schema.optional(Schema.Defect()),
}) {}
