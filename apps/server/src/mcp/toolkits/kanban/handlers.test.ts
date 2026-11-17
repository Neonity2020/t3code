import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  KanbanCardId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type KanbanCard,
  type ServerSettings as ServerSettingsContract,
} from "@t3tools/contracts";
import { McpSchema, McpServer } from "effect/ai";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as KanbanService from "../../../kanban/KanbanService.ts";
import * as PeerForwarding from "../../../peer/PeerForwarding.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";

const callerThreadId = ThreadId.make("mcp-kanban-thread");
const callerShell = McpToolAccessTestkit.liveThreadShell(callerThreadId);
const callerProjectId = callerShell.projectId;

const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("mcp-kanban-env"),
  requestNamespace: "mcp-kanban-session",
  thread: {
    threadId: callerThreadId,
    providerSessionId: "mcp-kanban-session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
};

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "mcp-kanban-test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-kanban-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const declaredFailure = (result: McpSchema.CallToolResult) => {
  const text = result.content[0];
  return result.isError === true && text?.type === "text" ? JSON.parse(text.text) : undefined;
};

it.effect(
  "reads, creates, and updates cards via MCP and gates access when kanbanPluginEnabled is disabled",
  () =>
    Effect.gen(function* () {
      const settingsRef = yield* Ref.make<ServerSettingsContract>(DEFAULT_SERVER_SETTINGS);
      const cardsRef = yield* Ref.make<ReadonlyArray<KanbanCard>>([
        {
          id: KanbanCardId.make("card:bound"),
          projectId: callerProjectId,
          title: "Bound task" as KanbanCard["title"],
          description: "Specs for calling agent" as KanbanCard["description"],
          column: "in_progress",
          position: 1024,
          priority: "high",
          tags: [],
          threadId: callerThreadId,
          archivedAt: null,
          createdAt: "2026-11-17T00:00:00.000Z",
          updatedAt: "2026-11-17T00:00:00.000Z",
        },
      ]);

      const testLayer = Layer.mergeAll(
        McpHttpServer.layerKanbanToolkit,
        McpHttpServer.layerKanbanPluginVisibility,
      ).pipe(
        Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
        Layer.provide(NodeCrypto.layer),
        Layer.provide(McpToolAccessTestkit.liveThreadsLayer),
        Layer.provide(Layer.mock(PeerForwarding.PeerForwarding)({})),
        Layer.provide(
          Layer.mock(ServerSettings.ServerSettingsService)({
            getSettings: Ref.get(settingsRef),
          }),
        ),
        Layer.provide(
          Layer.mock(KanbanService.KanbanService)({
            list: (input) =>
              Ref.get(cardsRef).pipe(
                Effect.map((cards) => ({
                  cards: input?.projectId
                    ? cards.filter((c) => c.projectId === input.projectId)
                    : cards,
                })),
              ),
            getById: (id) =>
              Ref.get(cardsRef).pipe(
                Effect.map((cards) => Option.fromNullishOr(cards.find((c) => c.id === id))),
              ),
            getByThreadId: (tid) =>
              Ref.get(cardsRef).pipe(
                Effect.map((cards) => cards.filter((c) => c.threadId === tid)),
              ),
            createCard: (input) =>
              Ref.modify(cardsRef, (cards) => {
                const card: KanbanCard = {
                  id: KanbanCardId.make(`card:new-${cards.length + 1}`),
                  projectId: input.projectId,
                  title: input.title,
                  description: (input.description ?? "") as KanbanCard["description"],
                  column: input.column ?? "backlog",
                  position: (cards.length + 1) * 1024,
                  priority: input.priority ?? "medium",
                  tags: input.tags ? [...input.tags] : [],
                  threadId: null,
                  archivedAt: null,
                  createdAt: "2026-11-17T00:00:00.000Z",
                  updatedAt: "2026-11-17T00:00:00.000Z",
                };
                return [{ card }, [...cards, card]];
              }),
            updateCard: (input) =>
              Ref.modify(cardsRef, (cards) => {
                const existing = cards.find((c) => c.id === input.id)!;
                const updated: KanbanCard = {
                  ...existing,
                  title: input.title ?? existing.title,
                  description: input.description ?? existing.description,
                  priority: input.priority ?? existing.priority,
                };
                return [{ card: updated }, cards.map((c) => (c.id === input.id ? updated : c))];
              }),
            moveCard: (input) =>
              Ref.modify(cardsRef, (cards) => {
                const existing = cards.find((c) => c.id === input.id)!;
                const updated: KanbanCard = { ...existing, column: input.column };
                return [{ card: updated }, cards.map((c) => (c.id === input.id ? updated : c))];
              }),
          }),
        ),
      );

      yield* Effect.gen(function* () {
        const server = yield* McpServer.McpServer;

        const call = (name: string, args: Record<string, unknown>) =>
          server
            .callTool({ name, arguments: args })
            .pipe(
              Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
              Effect.provideService(McpSchema.McpServerClient, client),
            );

        const getRes = yield* call("kanban_get_card", {});
        expect(getRes.isError).not.toBe(true);
        expect(getRes.structuredContent).toMatchObject({
          card: { id: "card:bound", title: "Bound task" },
        });

        const createRes = yield* call("kanban_create_cards", {
          cards: [{ title: "Follow-up task", column: "todo" }],
        });
        expect(createRes.isError).not.toBe(true);
        expect(createRes.structuredContent).toMatchObject({
          cards: [{ title: "Follow-up task", column: "todo" }],
        });

        const updateRes = yield* call("kanban_update_card", {
          column: "review",
        });
        expect(updateRes.isError).not.toBe(true);
        expect(updateRes.structuredContent).toMatchObject({
          card: { id: "card:bound", column: "review" },
        });

        // Disable Kanban plugin for this project -> tool calls are denied
        yield* Ref.set(settingsRef, {
          ...DEFAULT_SERVER_SETTINGS,
          projectSettingsOverrides: {
            [callerProjectId as ProjectId]: { kanbanPluginEnabled: false },
          },
        });

        const deniedList = yield* call("kanban_list_cards", {});
        expect(declaredFailure(deniedList)).toMatchObject({ code: "capability_denied" });
      }).pipe(Effect.provide(testLayer));
    }),
);
