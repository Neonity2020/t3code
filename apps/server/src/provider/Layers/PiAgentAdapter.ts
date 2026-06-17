// @effect-diagnostics nodeBuiltinImport:off - Pi Agent RPC requires a long-lived writable stdin.
import {
  EventId,
  RuntimeItemId,
  type PiAgentSettings,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ProviderDriverKind,
  ProviderInstanceId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { PiAgentAdapterShape } from "../Services/PiAgentAdapter.ts";
import { resolvePiAgentCommandPath } from "../PiAgentCommand.ts";

const PROVIDER = ProviderDriverKind.make("piAgent");
const decodeUnknownJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

interface PiAgentAdapterOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly instanceId?: ProviderInstanceId;
}

interface PendingRpcRequest {
  readonly command: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: ProviderAdapterRequestError) => void;
}

interface PiAgentSessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  readonly child: ChildProcessWithoutNullStreams;
  readonly pendingRequests: Map<string, PendingRpcRequest>;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  activeTurnId: TurnId | undefined;
  activeAssistantItemId: string | undefined;
  stopped: boolean;
  stderr: string;
  stdoutBuffer: string;
  stderrBuffer: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseModelSlug(model: string | null | undefined):
  | {
      readonly provider: string;
      readonly modelId: string;
    }
  | undefined {
  const trimmed = model?.trim();
  if (!trimmed || trimmed === "auto") return undefined;
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) return undefined;
  return {
    provider: trimmed.slice(0, slashIndex),
    modelId: trimmed.slice(slashIndex + 1),
  };
}

function toToolItemType(toolName: string | undefined) {
  switch (toolName) {
    case "bash":
    case "shell":
    case "terminal":
      return "command_execution" as const;
    case "read":
    case "write":
    case "edit":
    case "apply_patch":
      return "file_change" as const;
    default:
      return "dynamic_tool_call" as const;
  }
}

function encodeRpcCommand(command: Record<string, unknown>): string {
  return `${JSON.stringify(command)}\n`;
}

export function makePiAgentAdapter(
  piAgentSettings: PiAgentSettings,
  options?: PiAgentAdapterOptions,
) {
  return Effect.gen(function* () {
    const serverConfig = yield* ServerConfig;
    const crypto = yield* Crypto.Crypto;
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, PiAgentSessionContext>();
    const environment = options?.environment ?? process.env;
    const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("piAgent");

    const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
    const randomId = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate Pi Agent runtime identifier.",
            cause,
          }),
      ),
    );

    const emit = (event: ProviderRuntimeEvent) =>
      Queue.offer(runtimeEvents, event).pipe(Effect.asVoid);

    const buildEventBase = (input: {
      readonly threadId: ThreadId;
      readonly turnId?: TurnId;
      readonly itemId?: string;
    }) =>
      Effect.all({
        eventId: randomId.pipe(Effect.map(EventId.make)),
        createdAt: nowIso,
      }).pipe(
        Effect.map(({ eventId, createdAt }) => ({
          eventId,
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          createdAt,
          ...(input.turnId ? { turnId: input.turnId } : {}),
          ...(input.itemId ? { itemId: RuntimeItemId.make(input.itemId) } : {}),
        })),
      );

    const updateSession = (
      context: PiAgentSessionContext,
      patch: Partial<ProviderSession>,
      options?: { readonly clearActiveTurnId?: boolean; readonly clearLastError?: boolean },
    ) =>
      Effect.gen(function* () {
        const updatedAt = yield* nowIso;
        const next: ProviderSession = {
          ...context.session,
          ...patch,
          updatedAt,
        };
        if (options?.clearActiveTurnId) {
          delete (next as { activeTurnId?: TurnId }).activeTurnId;
        }
        if (options?.clearLastError) {
          delete (next as { lastError?: string }).lastError;
        }
        context.session = next;
      });

    function requireSession(threadId: ThreadId): PiAgentSessionContext {
      const context = sessions.get(threadId);
      if (!context) {
        throw new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId,
        });
      }
      return context;
    }

    const rejectAllPending = (context: PiAgentSessionContext, detail: string) => {
      for (const [id, pending] of context.pendingRequests) {
        context.pendingRequests.delete(id);
        pending.reject(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: pending.command,
            detail,
          }),
        );
      }
    };

    const requestRpc = (
      context: PiAgentSessionContext,
      command: Record<string, unknown> & { readonly type: string },
    ) =>
      Effect.gen(function* () {
        const id = `t3-${yield* randomId}`;
        return yield* Effect.callback<unknown, ProviderAdapterRequestError>((resume) => {
          if (context.stopped || context.child.killed || context.child.stdin.destroyed) {
            resume(
              Effect.fail(
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: command.type,
                  detail: "Pi Agent RPC process is not available.",
                }),
              ),
            );
            return;
          }

          context.pendingRequests.set(id, {
            command: command.type,
            resolve: (value) => resume(Effect.succeed(value)),
            reject: (error) => resume(Effect.fail(error)),
          });
          context.child.stdin.write(encodeRpcCommand({ ...command, id }), (error) => {
            if (error) {
              context.pendingRequests.delete(id);
              resume(
                Effect.fail(
                  new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: command.type,
                    detail: error.message,
                    cause: error,
                  }),
                ),
              );
            }
          });
        });
      });

    const handleRpcResponse = (
      context: PiAgentSessionContext,
      payload: Record<string, unknown>,
    ) => {
      const id = typeof payload.id === "string" ? payload.id : undefined;
      if (!id) return false;
      const pending = context.pendingRequests.get(id);
      if (!pending) return true;
      context.pendingRequests.delete(id);

      if (payload.success === true) {
        pending.resolve(payload.data);
      } else {
        const detail =
          typeof payload.error === "string" && payload.error.trim().length > 0
            ? payload.error
            : `Pi Agent RPC command '${pending.command}' failed.`;
        pending.reject(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: pending.command,
            detail,
            cause: payload,
          }),
        );
      }
      return true;
    };

    const handleRpcEvent = (context: PiAgentSessionContext, payload: Record<string, unknown>) =>
      Effect.gen(function* () {
        const eventType = stringField(payload, "type");
        if (eventType === "response") {
          handleRpcResponse(context, payload);
          return;
        }

        const turnId = context.activeTurnId;
        switch (eventType) {
          case "agent_start": {
            if (turnId) {
              yield* updateSession(context, { status: "running", activeTurnId: turnId });
              yield* emit({
                ...(yield* buildEventBase({ threadId: context.threadId, turnId })),
                type: "session.state.changed",
                payload: { state: "running", reason: "Pi Agent started processing." },
              });
            }
            break;
          }

          case "message_update": {
            const assistantMessageEvent = payload.assistantMessageEvent;
            if (!turnId || !isRecord(assistantMessageEvent)) {
              break;
            }
            const assistantEventType = stringField(assistantMessageEvent, "type");
            if (assistantEventType === "text_start") {
              context.activeAssistantItemId = `pi-agent-message-${yield* randomId}`;
            }
            if (assistantEventType === "text_delta") {
              const delta = assistantMessageEvent.delta;
              if (typeof delta !== "string" || delta.length === 0) {
                break;
              }
              if (!context.activeAssistantItemId) {
                context.activeAssistantItemId = `pi-agent-message-${yield* randomId}`;
              }
              yield* emit({
                ...(yield* buildEventBase({
                  threadId: context.threadId,
                  turnId,
                  itemId: context.activeAssistantItemId,
                })),
                type: "content.delta",
                payload: {
                  streamKind: "assistant_text",
                  delta,
                },
              });
            }
            if (assistantEventType === "text_end" && context.activeAssistantItemId) {
              yield* emit({
                ...(yield* buildEventBase({
                  threadId: context.threadId,
                  turnId,
                  itemId: context.activeAssistantItemId,
                })),
                type: "item.completed",
                payload: {
                  itemType: "assistant_message",
                  status: "completed",
                  title: "Assistant message",
                },
              });
              context.activeAssistantItemId = undefined;
            }
            break;
          }

          case "tool_execution_start":
          case "tool_execution_update":
          case "tool_execution_end": {
            if (!turnId) {
              break;
            }
            const toolCallId =
              stringField(payload, "toolCallId") ?? `pi-agent-tool-${yield* randomId}`;
            const toolName = stringField(payload, "toolName");
            yield* emit({
              ...(yield* buildEventBase({
                threadId: context.threadId,
                turnId,
                itemId: toolCallId,
              })),
              type: eventType === "tool_execution_end" ? "item.completed" : "item.updated",
              payload: {
                itemType: toToolItemType(toolName),
                status: eventType === "tool_execution_end" ? "completed" : "inProgress",
                title: toolName ?? "Pi Agent tool",
                data: payload,
              },
            });
            break;
          }

          case "agent_end": {
            if (turnId) {
              if (context.activeAssistantItemId) {
                yield* emit({
                  ...(yield* buildEventBase({
                    threadId: context.threadId,
                    turnId,
                    itemId: context.activeAssistantItemId,
                  })),
                  type: "item.completed",
                  payload: {
                    itemType: "assistant_message",
                    status: "completed",
                    title: "Assistant message",
                  },
                });
                context.activeAssistantItemId = undefined;
              }
              yield* emit({
                ...(yield* buildEventBase({ threadId: context.threadId, turnId })),
                type: "turn.completed",
                payload: {
                  state: "completed",
                  stopReason: null,
                },
              });
              context.turns.push({ id: turnId, items: [payload] });
              context.activeTurnId = undefined;
              yield* updateSession(
                context,
                { status: "ready" },
                { clearActiveTurnId: true, clearLastError: true },
              );
              yield* emit({
                ...(yield* buildEventBase({ threadId: context.threadId })),
                type: "session.state.changed",
                payload: { state: "ready", reason: "Pi Agent turn completed." },
              });
            }
            break;
          }

          case "extension_error": {
            const detail = stringField(payload, "message") ?? "Pi Agent extension error.";
            yield* emit({
              ...(yield* buildEventBase({
                threadId: context.threadId,
                ...(turnId ? { turnId } : {}),
              })),
              type: "runtime.error",
              payload: {
                message: detail,
                class: "provider_error",
                detail: payload,
              },
            });
            break;
          }
        }
      });

    const processStdoutChunk = (context: PiAgentSessionContext, chunk: Buffer) =>
      Effect.gen(function* () {
        context.stdoutBuffer += chunk.toString("utf8");
        while (true) {
          const newlineIndex = context.stdoutBuffer.indexOf("\n");
          if (newlineIndex === -1) {
            return;
          }
          const rawLine = context.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
          context.stdoutBuffer = context.stdoutBuffer.slice(newlineIndex + 1);
          if (!rawLine.trim()) {
            continue;
          }
          const parsedExit = yield* Effect.exit(decodeUnknownJson(rawLine));
          if (Exit.isFailure(parsedExit)) {
            yield* emit({
              ...(yield* buildEventBase({ threadId: context.threadId })),
              type: "runtime.warning",
              payload: {
                message: "Pi Agent RPC emitted invalid JSON.",
                detail: { line: rawLine, cause: parsedExit.cause },
              },
            });
            continue;
          }
          const parsed = parsedExit.value;
          if (isRecord(parsed)) {
            yield* handleRpcEvent(context, parsed);
          }
        }
      });

    const attachProcessHandlers = (context: PiAgentSessionContext) => {
      context.child.stdout.on("data", (chunk: Buffer) => {
        Effect.runFork(
          processStdoutChunk(context, chunk).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("Failed to process Pi Agent RPC event.", { cause }),
            ),
          ),
        );
      });
      context.child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        context.stderr += text;
        context.stderrBuffer = (context.stderrBuffer + text).slice(-8_000);
      });
      context.child.on("error", (error) => {
        rejectAllPending(context, error.message);
        Effect.runFork(
          Effect.gen(function* () {
            yield* emit({
              ...(yield* buildEventBase({ threadId: context.threadId })),
              type: "runtime.error",
              payload: {
                message: error.message,
                class: "provider_error",
              },
            });
          }),
        );
      });
      context.child.on("exit", (code, signal) => {
        if (context.stopped) return;
        context.stopped = true;
        const reason =
          code === 0
            ? "Pi Agent RPC process exited."
            : `Pi Agent RPC process exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`;
        rejectAllPending(context, context.stderrBuffer || reason);
        sessions.delete(context.threadId);
        Effect.runFork(
          Effect.gen(function* () {
            yield* updateSession(context, {
              status: code === 0 ? "closed" : "error",
              ...(code === 0 ? {} : { lastError: context.stderrBuffer || reason }),
            });
            yield* emit({
              ...(yield* buildEventBase({ threadId: context.threadId })),
              type: "session.exited",
              payload: {
                reason,
                recoverable: code !== 0,
                exitKind: code === 0 ? "graceful" : "error",
              },
            });
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("Failed to record Pi Agent exit.", { cause }),
            ),
          ),
        );
      });
    };

    yield* Effect.addFinalizer(() => {
      const cleanup = Effect.sync(() => {
        const contexts = [...sessions.values()];
        sessions.clear();
        for (const context of contexts) {
          context.stopped = true;
          rejectAllPending(context, "Pi Agent adapter is shutting down.");
          context.child.kill("SIGTERM");
        }
      });
      return cleanup.pipe(Effect.ensuring(Queue.shutdown(runtimeEvents)));
    });

    const startSession: PiAgentAdapterShape["startSession"] = Effect.fn("startSession")(
      function* (input) {
        if (input.provider !== undefined && input.provider !== PROVIDER) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Expected provider '${PROVIDER}', received '${input.provider}'.`,
          });
        }
        if (
          input.providerInstanceId !== undefined &&
          input.providerInstanceId !== boundInstanceId
        ) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Expected provider instance '${boundInstanceId}', received '${input.providerInstanceId}'.`,
          });
        }
        if (sessions.has(input.threadId)) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: "startSession called with existing active session",
          });
        }

        const cwd = input.cwd;
        const command = resolvePiAgentCommandPath(piAgentSettings);
        const args = ["--mode", "rpc"];
        const selectedModel = parseModelSlug(input.modelSelection?.model);
        if (selectedModel) {
          args.push("--provider", selectedModel.provider, "--model", selectedModel.modelId);
        }
        const child = spawn(command, args, {
          cwd,
          env: environment,
          shell: false,
          stdio: "pipe",
        });
        const createdAt = yield* nowIso;
        const session: ProviderSession = {
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          status: "connecting",
          runtimeMode: input.runtimeMode,
          ...(cwd ? { cwd } : {}),
          ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
          threadId: input.threadId,
          createdAt,
          updatedAt: createdAt,
        };
        const context: PiAgentSessionContext = {
          threadId: input.threadId,
          session,
          child,
          pendingRequests: new Map(),
          turns: [],
          activeTurnId: undefined,
          activeAssistantItemId: undefined,
          stopped: false,
          stderr: "",
          stdoutBuffer: "",
          stderrBuffer: "",
        };
        sessions.set(input.threadId, context);
        attachProcessHandlers(context);

        const state = yield* requestRpc(context, { type: "get_state" }).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: input.threadId,
                detail: cause.detail,
                cause,
              }),
          ),
          Effect.timeout("10 seconds"),
          Effect.catchTag("TimeoutError", (cause) =>
            Effect.fail(
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: input.threadId,
                detail: context.stderrBuffer || "Timed out waiting for Pi Agent RPC startup.",
                cause,
              }),
            ),
          ),
        );

        if (selectedModel) {
          yield* requestRpc(context, {
            type: "set_model",
            provider: selectedModel.provider,
            modelId: selectedModel.modelId,
          }).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterProcessError({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  detail: cause.detail,
                  cause,
                }),
            ),
          );
        }

        yield* updateSession(context, { status: "ready" }, { clearLastError: true });
        yield* emit({
          ...(yield* buildEventBase({ threadId: input.threadId })),
          type: "session.started",
          payload: {
            message: "Pi Agent RPC session started",
            resume: state,
          },
        });
        yield* emit({
          ...(yield* buildEventBase({ threadId: input.threadId })),
          type: "session.state.changed",
          payload: { state: "ready", reason: "Pi Agent RPC session ready" },
        });
        const providerThreadId = isRecord(state) ? stringField(state, "sessionId") : undefined;
        yield* emit({
          ...(yield* buildEventBase({ threadId: input.threadId })),
          type: "thread.started",
          payload: providerThreadId ? { providerThreadId } : {},
        });

        return context.session;
      },
    );

    const sendTurn: PiAgentAdapterShape["sendTurn"] = Effect.fn("sendTurn")(function* (input) {
      const context = requireSession(input.threadId);
      const steeringTurnId = context.activeTurnId;
      const turnId = steeringTurnId ?? TurnId.make(yield* randomId);

      const text = input.input?.trim();
      if (!text || text.length === 0) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Pi Agent turns require text input.",
        });
      }
      if (input.attachments && input.attachments.length > 0) {
        for (const attachment of input.attachments) {
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
        }
      }

      const modelSelection =
        input.modelSelection?.instanceId === boundInstanceId ? input.modelSelection : undefined;
      const parsedModel = parseModelSlug(modelSelection?.model);
      if (parsedModel) {
        yield* requestRpc(context, {
          type: "set_model",
          provider: parsedModel.provider,
          modelId: parsedModel.modelId,
        });
      }

      context.activeTurnId = turnId;
      yield* updateSession(
        context,
        {
          status: "running",
          activeTurnId: turnId,
          ...(modelSelection?.model ? { model: modelSelection.model } : {}),
        },
        { clearLastError: true },
      );
      if (steeringTurnId === undefined) {
        yield* emit({
          ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
          type: "turn.started",
          payload:
            (modelSelection?.model ?? context.session.model)
              ? { model: modelSelection?.model ?? context.session.model }
              : {},
        });
      }

      yield* requestRpc(context, {
        type: "prompt",
        message: text,
        ...(steeringTurnId ? { streamingBehavior: "steer" } : {}),
      }).pipe(
        Effect.tapError((cause) =>
          Effect.gen(function* () {
            if (!steeringTurnId) {
              context.activeTurnId = undefined;
              yield* updateSession(
                context,
                { status: "ready", lastError: cause.detail },
                { clearActiveTurnId: true },
              );
              yield* emit({
                ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
                type: "turn.aborted",
                payload: { reason: cause.detail },
              });
            }
          }),
        ),
      );

      return {
        threadId: input.threadId,
        turnId,
      };
    });

    const interruptTurn: PiAgentAdapterShape["interruptTurn"] = Effect.fn("interruptTurn")(
      function* (threadId, turnId) {
        const context = requireSession(threadId);
        yield* requestRpc(context, { type: "abort" });
        const abortedTurnId = turnId ?? context.activeTurnId;
        if (abortedTurnId) {
          context.activeTurnId = undefined;
          yield* updateSession(context, { status: "ready" }, { clearActiveTurnId: true });
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId: abortedTurnId })),
            type: "turn.aborted",
            payload: { reason: "Interrupted by user." },
          });
        }
      },
    );

    const respondToRequest: PiAgentAdapterShape["respondToRequest"] = (_threadId, requestId) =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "extension_ui_response",
          detail: `Pi Agent RPC request responses are not supported yet: ${requestId}`,
        }),
      );

    const respondToUserInput: PiAgentAdapterShape["respondToUserInput"] = (_threadId, requestId) =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "extension_ui_response",
          detail: `Pi Agent RPC user input responses are not supported yet: ${requestId}`,
        }),
      );

    const stopSession: PiAgentAdapterShape["stopSession"] = Effect.fn("stopSession")(
      function* (threadId) {
        const context = sessions.get(threadId);
        if (!context) {
          throw new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          });
        }
        context.stopped = true;
        sessions.delete(threadId);
        rejectAllPending(context, "Pi Agent session stopped.");
        context.child.kill("SIGTERM");
        yield* updateSession(context, { status: "closed" });
        yield* emit({
          ...(yield* buildEventBase({ threadId })),
          type: "session.exited",
          payload: {
            reason: "Session stopped.",
            recoverable: false,
            exitKind: "graceful",
          },
        });
      },
    );

    const listSessions: PiAgentAdapterShape["listSessions"] = () =>
      Effect.sync(() => [...sessions.values()].map((context) => context.session));

    const hasSession: PiAgentAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => sessions.has(threadId));

    const readThread: PiAgentAdapterShape["readThread"] = (threadId) =>
      Effect.sync(() => {
        const context = requireSession(threadId);
        return {
          threadId,
          turns: context.turns,
        };
      });

    const rollbackThread: PiAgentAdapterShape["rollbackThread"] = Effect.fn("rollbackThread")(
      function* (threadId, _numTurns) {
        return yield* readThread(threadId);
      },
    );

    const stopAll: PiAgentAdapterShape["stopAll"] = () =>
      Effect.sync(() => {
        const contexts = [...sessions.values()];
        sessions.clear();
        for (const context of contexts) {
          context.stopped = true;
          rejectAllPending(context, "Pi Agent adapter stopped.");
          context.child.kill("SIGTERM");
        }
      });

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session",
      },
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
      get streamEvents() {
        return Stream.fromQueue(runtimeEvents);
      },
    } satisfies PiAgentAdapterShape;
  }).pipe(Effect.scoped);
}
