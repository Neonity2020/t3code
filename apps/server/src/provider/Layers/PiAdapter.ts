import {
  ApprovalRequestId,
  EventId,
  type PiSettings,
  type ProviderApprovalDecision,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
  RuntimeItemId,
  RuntimeRequestId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterProcessError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { makePiRpcRuntime, type PiRpcEvent, type PiRpcRuntime } from "../pi/PiRpcRuntime.ts";

const PROVIDER = ProviderDriverKind.make("pi");
const PI_RESUME_VERSION = 1 as const;

const PiState = Schema.Struct({
  sessionId: Schema.String,
  sessionFile: Schema.optional(Schema.String),
  model: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        provider: Schema.String,
        id: Schema.String,
        contextWindow: Schema.optional(Schema.Number),
      }),
    ),
  ),
  thinkingLevel: Schema.optional(Schema.String),
});
const decodePiState = Schema.decodeUnknownEffect(PiState);
const decodePiSwitchSessionResult = Schema.decodeUnknownEffect(
  Schema.Struct({ cancelled: Schema.Boolean }),
);
const AnswerValue = Schema.Union([Schema.String, Schema.Array(Schema.String), Schema.Boolean]);
const decodeAnswerValue = Schema.decodeUnknownExit(AnswerValue);

interface PendingUiRequest {
  readonly piRequestId: string;
  readonly method: string;
}

interface PiSessionContext {
  readonly threadId: ThreadId;
  readonly scope: Scope.Closeable;
  readonly runtime: PiRpcRuntime;
  session: ProviderSession;
  activeTurnId: TurnId | undefined;
  assistantItemId: RuntimeItemId | undefined;
  eventFiber: Fiber.Fiber<void, never> | undefined;
  readonly pendingUi: Map<ApprovalRequestId, PendingUiRequest>;
  turns: Array<{ id: TurnId; items: Array<unknown> }>;
  stopped: boolean;
}

type PiAdapterError =
  | ProviderAdapterProcessError
  | ProviderAdapterRequestError
  | ProviderAdapterSessionNotFoundError
  | ProviderAdapterValidationError;

export function parsePiResumeCursor(value: unknown): string | undefined {
  const schema = Schema.Struct({
    schemaVersion: Schema.Literal(PI_RESUME_VERSION),
    sessionFile: Schema.String,
  });
  const decoded = Schema.decodeUnknownExit(schema)(value);
  return Exit.isSuccess(decoded) && decoded.value.sessionFile.trim()
    ? decoded.value.sessionFile.trim()
    : undefined;
}

export function parsePiModelSelection(
  model: string | undefined,
): { provider: string; modelId: string } | undefined {
  const value = model?.trim();
  if (!value || value === "default") return undefined;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) };
}

function displayModel(
  model: { provider: string; id: string } | null | undefined,
): string | undefined {
  return model ? `${model.provider}/${model.id}` : undefined;
}

function toolItemType(toolName: string): "command_execution" | "file_change" | "dynamic_tool_call" {
  if (toolName === "bash") return "command_execution";
  if (toolName === "edit" || toolName === "write") return "file_change";
  return "dynamic_tool_call";
}

function answerFrom(answers: ProviderUserInputAnswers): string | boolean | undefined {
  for (const value of Object.values(answers)) {
    const decoded = decodeAnswerValue(value);
    if (Exit.isFailure(decoded)) continue;
    if (typeof decoded.value === "string" || typeof decoded.value === "boolean") {
      return decoded.value;
    }
    return decoded.value[0];
  }
  return undefined;
}

export interface PiAdapterOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
}

export const makePiAdapter = Effect.fn("makePiAdapter")(function* (
  settings: PiSettings,
  options?: PiAdapterOptions,
) {
  const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("pi");
  const crypto = yield* Crypto.Crypto;
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  const sessions = new Map<ThreadId, PiSessionContext>();
  const runtimeEvents = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const environment = options?.environment ?? process.env;
  const randomUUIDv4 = crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "crypto/randomUUIDv4",
          detail: "Failed to allocate a Pi runtime identifier.",
          cause,
        }),
    ),
  );

  const makeStamp = Effect.fn("PiAdapter.makeStamp")(function* () {
    return {
      eventId: EventId.make(yield* randomUUIDv4),
      createdAt: DateTime.formatIso(yield* DateTime.now),
    };
  });
  const publish = (event: ProviderRuntimeEvent) =>
    PubSub.publish(runtimeEvents, event).pipe(Effect.asVoid, Effect.orDie);

  const requireSession = Effect.fn("PiAdapter.requireSession")(function* (threadId: ThreadId) {
    const context = sessions.get(threadId);
    if (!context || context.stopped) {
      return yield* new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId });
    }
    return context;
  });

  const appendTurnItem = (ctx: PiSessionContext, item: unknown): void => {
    if (!ctx.activeTurnId) return;
    const turn = ctx.turns.find((candidate) => candidate.id === ctx.activeTurnId);
    if (turn) turn.items.push(item);
    else ctx.turns.push({ id: ctx.activeTurnId, items: [item] });
  };

  const handleEvent = Effect.fn("PiAdapter.handleEvent")(function* (
    ctx: PiSessionContext,
    event: PiRpcEvent,
    raw: unknown,
  ) {
    const turnId = ctx.activeTurnId;
    const rawEvent = { source: "pi.rpc.event" as const, method: event.type, payload: raw };
    appendTurnItem(ctx, raw);

    if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update.type === "text_start" || update.type === "thinking_start") {
        if (update.type === "text_start" && turnId && !ctx.assistantItemId) {
          ctx.assistantItemId = RuntimeItemId.make(yield* randomUUIDv4);
          yield* publish({
            type: "item.started",
            ...(yield* makeStamp()),
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: ctx.threadId,
            turnId,
            itemId: ctx.assistantItemId,
            payload: { itemType: "assistant_message", status: "inProgress" },
            raw: rawEvent,
          });
        }
        return;
      }
      if ((update.type === "text_delta" || update.type === "thinking_delta") && turnId) {
        yield* publish({
          type: "content.delta",
          ...(yield* makeStamp()),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: ctx.threadId,
          turnId,
          ...(update.type === "text_delta" && ctx.assistantItemId
            ? { itemId: ctx.assistantItemId }
            : {}),
          payload: {
            streamKind: update.type === "text_delta" ? "assistant_text" : "reasoning_text",
            delta: update.delta,
            contentIndex: update.contentIndex,
          },
          raw: rawEvent,
        });
      }
      if (event.usage && turnId) {
        const usedTokens = Math.max(0, Math.trunc(event.usage.totalTokens));
        yield* publish({
          type: "thread.token-usage.updated",
          ...(yield* makeStamp()),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: ctx.threadId,
          turnId,
          payload: {
            usage: {
              usedTokens,
              totalProcessedTokens: usedTokens,
              inputTokens: Math.max(0, Math.trunc(event.usage.input)),
              cachedInputTokens: Math.max(0, Math.trunc(event.usage.cacheRead)),
              outputTokens: Math.max(0, Math.trunc(event.usage.output)),
              compactsAutomatically: true,
            },
          },
          raw: rawEvent,
        });
      }
      return;
    }

    if (event.type === "message_end" && turnId && ctx.assistantItemId) {
      yield* publish({
        type: "item.completed",
        ...(yield* makeStamp()),
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId: ctx.threadId,
        turnId,
        itemId: ctx.assistantItemId,
        payload: { itemType: "assistant_message", status: "completed", data: event.message },
        raw: rawEvent,
      });
      ctx.assistantItemId = undefined;
      return;
    }

    if (
      event.type === "tool_execution_start" ||
      event.type === "tool_execution_update" ||
      event.type === "tool_execution_end"
    ) {
      if (!turnId) return;
      const isEnd = event.type === "tool_execution_end";
      const isError = isEnd && event.isError;
      yield* publish({
        type: isEnd
          ? "item.completed"
          : event.type === "tool_execution_start"
            ? "item.started"
            : "item.updated",
        ...(yield* makeStamp()),
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId: ctx.threadId,
        turnId,
        itemId: RuntimeItemId.make(event.toolCallId),
        payload: {
          itemType: toolItemType(event.toolName),
          status: isError ? "failed" : isEnd ? "completed" : "inProgress",
          title: event.toolName,
          data:
            event.type === "tool_execution_start"
              ? { args: event.args }
              : event.type === "tool_execution_update"
                ? { args: event.args, partialResult: event.partialResult }
                : { result: event.result },
        },
        raw: rawEvent,
      });
      return;
    }

    if (event.type === "extension_ui_request") {
      if (!["select", "confirm", "input", "editor"].includes(event.method)) return;
      const requestId = ApprovalRequestId.make(event.id);
      ctx.pendingUi.set(requestId, { piRequestId: event.id, method: event.method });
      const options =
        event.method === "confirm"
          ? [
              { label: "Confirm", description: "Confirm this Pi request." },
              { label: "Cancel", description: "Cancel this Pi request." },
            ]
          : (event.options ?? []).map((label) => ({ label, description: label }));
      yield* publish({
        type: "user-input.requested",
        ...(yield* makeStamp()),
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId: ctx.threadId,
        turnId,
        requestId: RuntimeRequestId.make(requestId),
        payload: {
          questions: [
            {
              id: "value",
              header: event.title?.trim() || "Pi",
              question: event.message?.trim() || event.title?.trim() || "Pi needs your input.",
              options,
              multiSelect: false,
            },
          ],
        },
        raw: rawEvent,
      });
      return;
    }

    if (event.type === "agent_settled" && turnId) {
      const completedAt = DateTime.formatIso(yield* DateTime.now);
      yield* publish({
        type: "turn.completed",
        ...(yield* makeStamp()),
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId: ctx.threadId,
        turnId,
        payload: { state: "completed" },
        raw: rawEvent,
      });
      ctx.activeTurnId = undefined;
      ctx.assistantItemId = undefined;
      const { activeTurnId: _activeTurnId, ...ready } = ctx.session;
      ctx.session = { ...ready, status: "ready", updatedAt: completedAt };
    }
  });

  const stopInternal = Effect.fn("PiAdapter.stopInternal")(function* (ctx: PiSessionContext) {
    if (ctx.stopped) return;
    ctx.stopped = true;
    yield* ctx.runtime.stop.pipe(Effect.ignore);
    yield* Scope.close(ctx.scope, Exit.void);
    sessions.delete(ctx.threadId);
  });

  const startSession: ProviderAdapterShape<PiAdapterError>["startSession"] = (input) =>
    Effect.gen(function* () {
      if (!input.cwd?.trim()) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: "cwd is required and must be non-empty.",
        });
      }
      const existing = sessions.get(input.threadId);
      if (existing) yield* stopInternal(existing);
      const cwd = path.resolve(input.cwd.trim());
      const scope = yield* Scope.make("sequential");
      const resumeFile = parsePiResumeCursor(input.resumeCursor);
      const runtime = yield* makePiRpcRuntime({
        binaryPath: settings.binaryPath || "pi",
        args: ["--mode", "rpc"],
        cwd,
        env: environment,
        threadId: input.threadId,
      }).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
        Effect.provideService(Scope.Scope, scope),
      );
      yield* Scope.addFinalizer(scope, runtime.stop);

      const selectedModel =
        input.modelSelection?.instanceId === boundInstanceId
          ? parsePiModelSelection(input.modelSelection.model)
          : undefined;
      const stateResponse = yield* Effect.gen(function* () {
        if (resumeFile) {
          const switchResponse = yield* runtime.request({
            type: "switch_session",
            sessionPath: resumeFile,
          });
          const switchResult = yield* decodePiSwitchSessionResult(switchResponse.data).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "switch_session",
                  detail: "Pi returned an invalid session switch result.",
                  cause,
                }),
            ),
          );
          if (switchResult.cancelled) {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "switch_session",
              detail: "Pi cancelled the requested session resume.",
            });
          }
        }
        if (selectedModel) {
          yield* runtime.request({ type: "set_model", ...selectedModel });
        }
        return yield* runtime.request({ type: "get_state" });
      }).pipe(Effect.onError(() => Scope.close(scope, Exit.void)));
      const state = yield* decodePiState(stateResponse.data).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "get_state",
              detail: "Pi returned an invalid session state.",
              cause,
            }),
        ),
        Effect.onError(() => Scope.close(scope, Exit.void)),
      );
      const now = DateTime.formatIso(yield* DateTime.now);
      const session: ProviderSession = {
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        cwd,
        ...(displayModel(state.model) ? { model: displayModel(state.model) } : {}),
        threadId: input.threadId,
        ...(state.sessionFile
          ? { resumeCursor: { schemaVersion: PI_RESUME_VERSION, sessionFile: state.sessionFile } }
          : {}),
        createdAt: now,
        updatedAt: now,
      };
      const ctx: PiSessionContext = {
        threadId: input.threadId,
        scope,
        runtime,
        session,
        activeTurnId: undefined,
        assistantItemId: undefined,
        eventFiber: undefined,
        pendingUi: new Map(),
        turns: [],
        stopped: false,
      };
      sessions.set(input.threadId, ctx);
      ctx.eventFiber = yield* runtime.events.pipe(
        Stream.runForEach(({ event, raw }) => handleEvent(ctx, event, raw)),
        Effect.catch((cause) => Effect.logError("Pi runtime event consumer failed.", { cause })),
        Effect.forkIn(scope),
      );
      yield* publish({
        type: "session.started",
        ...(yield* makeStamp()),
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId: input.threadId,
        payload: { resume: session.resumeCursor },
      });
      yield* publish({
        type: "thread.started",
        ...(yield* makeStamp()),
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId: input.threadId,
        payload: { providerThreadId: state.sessionId },
      });
      return session;
    });

  const sendTurn: ProviderAdapterShape<PiAdapterError>["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const ctx = yield* requireSession(input.threadId);
      const text = input.input?.trim();
      const images = yield* Effect.forEach(input.attachments ?? [], (attachment) =>
        Effect.gen(function* () {
          const attachmentPath = resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment,
          });
          if (!attachmentPath) {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "prompt",
              detail: `Invalid attachment id '${attachment.id}'.`,
            });
          }
          const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "prompt",
                  detail: cause.message,
                  cause,
                }),
            ),
          );
          return {
            type: "image",
            data: Buffer.from(bytes).toString("base64"),
            mimeType: attachment.mimeType,
          };
        }),
      );
      if (!text && images.length === 0) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Turn requires non-empty text or attachments.",
        });
      }
      const selectedModel =
        input.modelSelection?.instanceId === boundInstanceId
          ? parsePiModelSelection(input.modelSelection.model)
          : undefined;
      if (selectedModel) yield* ctx.runtime.request({ type: "set_model", ...selectedModel });
      const existingTurnId = ctx.activeTurnId;
      const turnId = existingTurnId ?? TurnId.make(yield* randomUUIDv4);
      if (!existingTurnId) {
        ctx.activeTurnId = turnId;
        ctx.turns.push({ id: turnId, items: [] });
        yield* publish({
          type: "turn.started",
          ...(yield* makeStamp()),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          turnId,
          payload: { model: input.modelSelection?.model },
        });
      }
      const updatedAt = DateTime.formatIso(yield* DateTime.now);
      ctx.session = { ...ctx.session, status: "running", activeTurnId: turnId, updatedAt };
      yield* ctx.runtime.request({
        type: "prompt",
        message: text ?? "",
        ...(images.length > 0 ? { images } : {}),
        ...(existingTurnId ? { streamingBehavior: "steer" } : {}),
      });
      return { threadId: input.threadId, turnId, resumeCursor: ctx.session.resumeCursor };
    });

  const interruptTurn: ProviderAdapterShape<PiAdapterError>["interruptTurn"] = (threadId, turnId) =>
    Effect.gen(function* () {
      const ctx = yield* requireSession(threadId);
      if (turnId && ctx.activeTurnId && turnId !== ctx.activeTurnId) return;
      yield* ctx.runtime.request({ type: "abort" });
      const interrupted = turnId ?? ctx.activeTurnId;
      if (interrupted) {
        yield* publish({
          type: "turn.aborted",
          ...(yield* makeStamp()),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId,
          turnId: interrupted,
          payload: { reason: "Interrupted by user" },
        });
      }
      ctx.activeTurnId = undefined;
      ctx.assistantItemId = undefined;
    });

  const respondToRequest = (
    _threadId: ThreadId,
    _requestId: ApprovalRequestId,
    _decision: ProviderApprovalDecision,
  ) =>
    Effect.fail(
      new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "respondToRequest",
        detail: "Pi RPC uses structured extension UI requests instead of approval requests.",
      }),
    );

  const respondToUserInput = (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ) =>
    Effect.gen(function* () {
      const ctx = yield* requireSession(threadId);
      const pending = ctx.pendingUi.get(requestId);
      if (!pending) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "extension_ui_response",
          detail: `Unknown Pi UI request '${requestId}'.`,
        });
      }
      const answer = answerFrom(answers);
      const command =
        answer === undefined
          ? { type: "extension_ui_response", id: pending.piRequestId, cancelled: true }
          : pending.method === "confirm"
            ? {
                type: "extension_ui_response",
                id: pending.piRequestId,
                confirmed: answer === true || answer === "Confirm",
              }
            : { type: "extension_ui_response", id: pending.piRequestId, value: String(answer) };
      yield* ctx.runtime.notify(command);
      ctx.pendingUi.delete(requestId);
      yield* publish({
        type: "user-input.resolved",
        ...(yield* makeStamp()),
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId,
        turnId: ctx.activeTurnId,
        requestId: RuntimeRequestId.make(requestId),
        payload: { answers },
      });
      return;
    });

  const readThread: ProviderAdapterShape<PiAdapterError>["readThread"] = (threadId) =>
    requireSession(threadId).pipe(Effect.map((ctx) => ({ threadId, turns: ctx.turns })));
  const rollbackThread: ProviderAdapterShape<PiAdapterError>["rollbackThread"] = (
    threadId,
    _numTurns,
  ) =>
    requireSession(threadId).pipe(
      Effect.flatMap(() =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "rollbackThread",
            detail: "Pi RPC does not expose turn-count rollback.",
          }),
        ),
      ),
    );
  const stopSession = (threadId: ThreadId) =>
    requireSession(threadId).pipe(Effect.flatMap(stopInternal));
  const listSessions = () =>
    Effect.sync(() => Array.from(sessions.values(), (ctx) => ({ ...ctx.session })));
  const hasSession = (threadId: ThreadId) => Effect.sync(() => sessions.has(threadId));
  const stopAll = () =>
    Effect.forEach(Array.from(sessions.values()), stopInternal, { discard: true });

  yield* Effect.addFinalizer(() =>
    stopAll().pipe(Effect.tap(() => PubSub.shutdown(runtimeEvents))),
  );

  return {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session" },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    streamEvents: Stream.fromPubSub(runtimeEvents),
  } satisfies ProviderAdapterShape<PiAdapterError>;
});
