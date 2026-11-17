import {
  type KanbanCard,
  type KanbanCardId,
  type KanbanError,
  OrchestratorMcpFailure,
  type ProjectId,
  resolveBuiltinPluginEnabled,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as KanbanService from "../../../kanban/KanbanService.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { KanbanToolkit } from "./tools.ts";

const mapKanbanFailure = (error: KanbanError): OrchestratorMcpFailure => {
  switch (error.code) {
    case "not_found":
      return new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });
    case "plugin_disabled":
      return new OrchestratorMcpFailure({ code: "capability_denied", message: error.message });
    case "invalid_request":
      return new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });
    default:
      return new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });
  }
};

const resolveCardForCaller = Effect.fn("mcp.kanban.resolveCardForCaller")(function* (
  kanban: KanbanService.KanbanService["Service"],
  cardId: KanbanCardId | undefined,
  callerThreadId: KanbanCard["threadId"],
) {
  if (cardId !== undefined) {
    const found = yield* kanban.getById(cardId).pipe(Effect.mapError(mapKanbanFailure));
    if (Option.isNone(found)) {
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message: `Kanban card ${cardId} was not found.`,
      });
    }
    return found.value;
  }
  if (callerThreadId === null) {
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "Pass `cardId`: this MCP client is not running inside a T3 thread.",
    });
  }
  const linked = yield* kanban
    .getByThreadId(callerThreadId)
    .pipe(Effect.mapError(mapKanbanFailure));
  return linked[0] ?? null;
});

export const layer = McpToolAccess.toLayer(KanbanToolkit, {
  kanban_list_cards: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const { caller } = yield* readCaller();
      const kanban = yield* KanbanService.KanbanService;
      const settingsService = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
      const settings = Option.isSome(settingsService)
        ? yield* settingsService.value.getSettings.pipe(Effect.orElseSucceed(() => null))
        : null;

      const projectId: ProjectId | undefined = input.projectId ?? caller?.projectId;
      if (
        projectId !== undefined &&
        settings !== null &&
        !resolveBuiltinPluginEnabled(settings, "kanban", projectId)
      ) {
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "The Kanban plugin is disabled for this project.",
        });
      }

      const { cards } = yield* kanban
        .list({
          ...(projectId === undefined ? {} : { projectId }),
          includeArchived: input.includeArchived === true,
        })
        .pipe(Effect.mapError(mapKanbanFailure));

      const tagLower = input.tag?.toLowerCase();
      const filtered = cards.filter((card) => {
        if (settings !== null && !resolveBuiltinPluginEnabled(settings, "kanban", card.projectId)) {
          return false;
        }
        if (input.column !== undefined && card.column !== input.column) return false;
        if (tagLower !== undefined && !card.tags.some((t) => t.toLowerCase() === tagLower)) {
          return false;
        }
        return true;
      });

      return {
        cards: filtered.map((card) => ({
          id: card.id,
          projectId: card.projectId,
          title: card.title,
          column: card.column,
          priority: card.priority,
          tags: card.tags,
          threadId: card.threadId,
          archivedAt: card.archivedAt,
          updatedAt: card.updatedAt,
        })),
      };
    }),
  ),

  kanban_get_card: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const { caller } = yield* readCaller();
      const kanban = yield* KanbanService.KanbanService;
      const card = yield* resolveCardForCaller(kanban, input.cardId, caller?.id ?? null);
      if (card !== null) {
        const settingsService = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
        if (Option.isSome(settingsService)) {
          const settings = yield* settingsService.value.getSettings.pipe(
            Effect.orElseSucceed(() => null),
          );
          if (
            settings !== null &&
            !resolveBuiltinPluginEnabled(settings, "kanban", card.projectId)
          ) {
            return yield* new OrchestratorMcpFailure({
              code: "capability_denied",
              message: "The Kanban plugin is disabled for this project.",
            });
          }
        }
      }
      return { card };
    }),
  ),

  kanban_create_cards: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const { caller } = yield* readCaller();
      const kanban = yield* KanbanService.KanbanService;
      const projectId = input.projectId ?? caller?.projectId;
      if (projectId === undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "Pass `projectId`: this MCP client is not running inside a T3 thread.",
        });
      }

      const created: Array<KanbanCard> = [];
      for (const item of input.cards) {
        const result = yield* kanban
          .createCard({
            projectId,
            title: item.title,
            ...(item.description === undefined ? {} : { description: item.description }),
            ...(item.column === undefined ? {} : { column: item.column }),
            ...(item.priority === undefined ? {} : { priority: item.priority }),
            ...(item.tags === undefined ? {} : { tags: item.tags }),
            autoStart: input.autoStart === true,
            createdBy: "agent",
            creationSource: "mcp",
          })
          .pipe(Effect.mapError(mapKanbanFailure));
        created.push(result.card);
      }
      return { cards: created };
    }),
  ),

  kanban_update_card: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const { caller } = yield* readCaller();
      const kanban = yield* KanbanService.KanbanService;
      const target = yield* resolveCardForCaller(kanban, input.cardId, caller?.id ?? null);
      if (target === null) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "No kanban card is linked to this thread. Pass `cardId`.",
        });
      }

      let current = target;
      if (
        input.title !== undefined ||
        input.description !== undefined ||
        input.priority !== undefined ||
        input.tags !== undefined
      ) {
        const updated = yield* kanban
          .updateCard({
            id: current.id,
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.priority === undefined ? {} : { priority: input.priority }),
            ...(input.tags === undefined ? {} : { tags: input.tags }),
          })
          .pipe(Effect.mapError(mapKanbanFailure));
        current = updated.card;
      }

      if (input.column !== undefined || input.beforeCardId !== undefined) {
        const moved = yield* kanban
          .moveCard({
            id: current.id,
            column: input.column ?? current.column,
            ...(input.beforeCardId === undefined ? {} : { beforeCardId: input.beforeCardId }),
            autoStart: input.autoStart === true,
            createdBy: "agent",
            creationSource: "mcp",
          })
          .pipe(Effect.mapError(mapKanbanFailure));
        current = moved.card;
      }

      if (input.archived !== undefined && Boolean(current.archivedAt !== null) !== input.archived) {
        const archivedRes = yield* kanban
          .setArchived({
            id: current.id,
            archived: input.archived,
          })
          .pipe(Effect.mapError(mapKanbanFailure));
        current = archivedRes.card;
      }

      return { card: current };
    }),
  ),
});
