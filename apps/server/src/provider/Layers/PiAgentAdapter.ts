// @ts-nocheck
/**
 * Pi Agent adapter.
 *
 * Pi deliberately exposes a process RPC transport rather than an HTTP API.
 * One child is therefore owned by each T3 Code thread and remains alive for
 * its whole provider session. The protocol is LF-delimited JSONL; do not use
 * Node's readline here because it also splits valid U+2028/U+2029 JSON text.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  EventId,
  type PiAgentSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { PiAgentAdapterShape } from "../Services/PiAgentAdapter.ts";

const PROVIDER = ProviderDriverKind.make("piAgent");
const PI_RESUME_VERSION = 1 as const;

type PiRpcRecord = Record<string, unknown>;

interface PendingRequest {
  readonly resolve: (value: PiRpcRecord) => void;
  readonly reject: (cause: Error) => void;
}

interface PiSessionContext {
  readonly threadId: ThreadId;
  readonly child: ChildProcess;
  readonly pending: Map<string, PendingRequest>;
  session: ProviderSession;
  activeTurnId: TurnId | undefined;
  stdoutRemainder: string;
  closed: boolean;
  turns: Array<{ readonly id: TurnId; readonly items: Array<unknown> }>;
}

function isRecord(value: unknown): value is PiRpcRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Exported for focused protocol tests. Splits only on LF as Pi requires. */
export function takePiRpcRecords(input: string): {
  readonly records: ReadonlyArray<string>;
  readonly remainder: string;
} {
  const records: Array<string> = [];
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] !== "\n") continue;
    const record = input.slice(start, index).replace(/\r$/, "");
    if (record.length > 0) records.push(record);
    start = index + 1;
  }
  return { records, remainder: input.slice(start) };
}

function piResumeCursor(value: unknown): { readonly sessionPath: string } | undefined {
  if (!isRecord(value) || value.schemaVersion !== PI_RESUME_VERSION) return undefined;
  return typeof value.sessionPath === "string" && value.sessionPath.trim()
    ? { sessionPath: value.sessionPath.trim() }
    : undefined;
}

function eventStamp() {
  return { eventId: EventId.make(randomUUID()), createdAt: new Date().toISOString() };
}

function eventTextDelta(record: PiRpcRecord): string | undefined {
  if (record.type !== "message_update" || !isRecord(record.assistantMessageEvent)) return undefined;
  const update = record.assistantMessageEvent;
  return update.type === "text_delta" && typeof update.delta === "string"
    ? update.delta
    : undefined;
}

function eventTool(
  record: PiRpcRecord,
): { readonly id: string; readonly name: string } | undefined {
  if (!isRecord(record.toolCall)) return undefined;
  const id = typeof record.toolCall.id === "string" ? record.toolCall.id : undefined;
  const name = typeof record.toolCall.name === "string" ? record.toolCall.name : undefined;
  return id && name ? { id, name } : undefined;
}

function toolItemType(name: string): "command_execution" | "file_change" | "dynamic_tool_call" {
  const normalized = name.toLowerCase();
  if (normalized === "bash" || normalized.includes("command")) return "command_execution";
  if (normalized === "edit" || normalized === "write") return "file_change";
  return "dynamic_tool_call";
}

function resolvePiBinary(configuredPath: string): string {
  if (configuredPath !== "pi") return configuredPath;
  const bunPi = join(homedir(), ".bun", "bin", "pi");
  return existsSync(bunPi) ? bunPi : configuredPath;
}

export interface PiAgentAdapterOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
}

export function makePiAgentAdapter(settings: PiAgentSettings, options?: PiAgentAdapterOptions) {
  return Effect.gen(function* () {
    const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("piAgent");
    const sessions = new Map<ThreadId, PiSessionContext>();
    const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();

    const publish = (event: ProviderRuntimeEvent) =>
      Effect.runPromise(PubSub.publish(events, event).pipe(Effect.asVoid));

    const send = (ctx: PiSessionContext, command: PiRpcRecord): Promise<PiRpcRecord> => {
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        if (ctx.closed || !ctx.child.stdin.writable) {
          reject(new Error("Pi Agent RPC process is not running."));
          return;
        }
        ctx.pending.set(id, { resolve, reject });
        ctx.child.stdin.write(`${JSON.stringify({ ...command, id })}\n`, (error) => {
          if (error) {
            ctx.pending.delete(id);
            reject(error);
          }
        });
      });
    };

    const sendBestEffort = (ctx: PiSessionContext, command: PiRpcRecord) => {
      void send(ctx, command).catch(() => undefined);
    };

    const handleRecord = (ctx: PiSessionContext, record: PiRpcRecord) => {
      if (record.type === "response" && typeof record.id === "string") {
        const pending = ctx.pending.get(record.id);
        if (pending) {
          ctx.pending.delete(record.id);
          record.success === false
            ? pending.reject(
                new Error(
                  typeof record.error === "string" ? record.error : "Pi RPC command failed.",
                ),
              )
            : pending.resolve(record);
        }
        return;
      }

      // Extensions can ask their host UI to render a notification, question,
      // or picker. T3 Code does not yet render Pi extension UI, but every
      // request must receive a response or Pi pauses the session forever.
      // A cancellation is safe for all interactive request kinds and makes
      // non-blocking notifications (such as the user's language extension)
      // continue immediately.
      if (record.type === "extension_ui_request" && typeof record.id === "string") {
        ctx.child.stdin?.write(
          `${JSON.stringify({ type: "extension_ui_response", id: record.id, cancelled: true })}\n`,
        );
        return;
      }

      const turnId = ctx.activeTurnId;
      const raw = {
        source: "pi.rpc" as const,
        messageType: typeof record.type === "string" ? record.type : undefined,
        payload: record,
      };
      const delta = eventTextDelta(record);
      if (delta && turnId) {
        void publish({
          type: "content.delta",
          ...eventStamp(),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: ctx.threadId,
          turnId,
          payload: { streamKind: "assistant_text", delta },
          raw,
        });
      }

      if (record.type === "tool_execution_start" || record.type === "tool_execution_end") {
        const tool = eventTool(record);
        if (turnId && tool) {
          void publish({
            type: record.type === "tool_execution_start" ? "item.started" : "item.completed",
            ...eventStamp(),
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: ctx.threadId,
            turnId,
            itemId: RuntimeItemId.make(tool.id),
            payload: {
              itemType: toolItemType(tool.name),
              status: record.type === "tool_execution_start" ? "inProgress" : "completed",
              title: tool.name,
              data: record,
            },
            raw,
          });
        }
      }

      if (record.type === "agent_end" && turnId) {
        ctx.activeTurnId = undefined;
        ctx.session = { ...ctx.session, status: "ready", updatedAt: new Date().toISOString() };
        void publish({
          type: "turn.completed",
          ...eventStamp(),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: ctx.threadId,
          turnId,
          payload: { state: "completed" },
          raw,
        });
      }
    };

    const requireSession = (threadId: ThreadId) => {
      const ctx = sessions.get(threadId);
      return ctx === undefined
        ? Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }))
        : Effect.succeed(ctx);
    };

    const startSession: PiAgentAdapterShape["startSession"] = (input) =>
      Effect.gen(function* () {
        if (input.provider !== undefined && input.provider !== PROVIDER) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Expected '${PROVIDER}'.`,
          });
        }
        const existing = sessions.get(input.threadId);
        if (existing) {
          existing.closed = true;
          existing.child.kill();
          sessions.delete(input.threadId);
        }
        const model =
          input.modelSelection?.instanceId === boundInstanceId
            ? input.modelSelection.model
            : undefined;
        const child = yield* Effect.try({
          try: () =>
            spawn(
              resolvePiBinary(settings.binaryPath),
              ["--mode", "rpc", ...(model ? ["--model", model] : [])],
              {
                cwd: input.cwd ?? process.cwd(),
                env: options?.environment ?? process.env,
                stdio: ["pipe", "pipe", "pipe"],
              },
            ),
          catch: (cause) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId: input.threadId,
              detail: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
        const now = new Date().toISOString();
        const ctx: PiSessionContext = {
          threadId: input.threadId,
          child,
          pending: new Map(),
          stdoutRemainder: "",
          closed: false,
          activeTurnId: undefined,
          turns: [],
          session: {
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            status: "ready",
            runtimeMode: input.runtimeMode,
            cwd: input.cwd,
            ...(model ? { model } : {}),
            threadId: input.threadId,
            createdAt: now,
            updatedAt: now,
          },
        };
        child.stdout.on("data", (chunk: Buffer) => {
          const parsed = takePiRpcRecords(ctx.stdoutRemainder + chunk.toString("utf8"));
          ctx.stdoutRemainder = parsed.remainder;
          for (const line of parsed.records) {
            try {
              const value: unknown = JSON.parse(line);
              if (isRecord(value)) handleRecord(ctx, value);
            } catch {
              /* malformed diagnostics never break the session */
            }
          }
        });
        child.on("exit", (code) => {
          if (ctx.closed) return;
          ctx.closed = true;
          for (const pending of ctx.pending.values())
            pending.reject(new Error(`Pi Agent exited (${code ?? "unknown"}).`));
          ctx.pending.clear();
          void publish({
            type: "session.exited",
            ...eventStamp(),
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: ctx.threadId,
            payload: {
              reason: `Pi Agent exited (${code ?? "unknown"}).`,
              exitKind: code === 0 ? "graceful" : "error",
            },
          });
        });
        sessions.set(input.threadId, ctx);
        const resumed = piResumeCursor(input.resumeCursor);
        if (resumed) {
          yield* Effect.tryPromise({
            try: () => send(ctx, { type: "switch_session", sessionPath: resumed.sessionPath }),
            catch: (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: input.threadId,
                detail: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
          });
        }
        const state = yield* Effect.tryPromise({
          try: () => send(ctx, { type: "get_state" }),
          catch: () => ({}),
        });
        const stateData = isRecord(state.data) ? state.data : undefined;
        const sessionPath =
          stateData && typeof stateData.sessionFile === "string"
            ? stateData.sessionFile
            : undefined;
        if (sessionPath)
          ctx.session = {
            ...ctx.session,
            resumeCursor: { schemaVersion: PI_RESUME_VERSION, sessionPath },
          };
        yield* PubSub.publishAll(events, [
          {
            type: "session.started",
            ...eventStamp(),
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: input.threadId,
            payload: { resume: ctx.session.resumeCursor },
          },
          {
            type: "session.state.changed",
            ...eventStamp(),
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: input.threadId,
            payload: { state: "ready", reason: "Pi Agent RPC session ready" },
          },
          {
            type: "thread.started",
            ...eventStamp(),
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: input.threadId,
            payload: { providerThreadId: sessionPath },
          },
        ]);
        return ctx.session;
      });

    const sendTurn: PiAgentAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        if (input.attachments?.length)
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Pi Agent attachments are not supported yet.",
          });
        const ctx = yield* requireSession(input.threadId);
        const steering = ctx.activeTurnId !== undefined;
        const turnId = ctx.activeTurnId ?? TurnId.make(randomUUID());
        ctx.activeTurnId = turnId;
        ctx.session = {
          ...ctx.session,
          status: "running",
          activeTurnId: turnId,
          updatedAt: new Date().toISOString(),
        };
        if (!steering) {
          yield* PubSub.publish(events, {
            type: "turn.started",
            ...eventStamp(),
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: input.threadId,
            turnId,
            payload: {},
          });
        }
        yield* Effect.tryPromise({
          try: () =>
            send(ctx, {
              type: "prompt",
              message: input.input ?? "",
              ...(steering ? { streamingBehavior: "steer" } : {}),
            }),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "prompt",
              detail: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
        return {
          threadId: input.threadId,
          turnId,
          ...(ctx.session.resumeCursor ? { resumeCursor: ctx.session.resumeCursor } : {}),
        };
      });

    const interruptTurn: PiAgentAdapterShape["interruptTurn"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        sendBestEffort(ctx, { type: "abort" });
      });
    const stopSession: PiAgentAdapterShape["stopSession"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        ctx.closed = true;
        sendBestEffort(ctx, { type: "abort" });
        ctx.child.kill();
        sessions.delete(threadId);
      });

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "unsupported" },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest: (threadId) => requireSession(threadId).pipe(Effect.asVoid),
      respondToUserInput: (threadId) => requireSession(threadId).pipe(Effect.asVoid),
      stopSession,
      listSessions: () => Effect.sync(() => Array.from(sessions.values(), (ctx) => ctx.session)),
      hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
      readThread: (threadId) =>
        requireSession(threadId).pipe(Effect.map((ctx) => ({ threadId, turns: ctx.turns }))),
      rollbackThread: (threadId) =>
        Effect.fail(
          new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: `Pi Agent does not support rollback for '${threadId}'.`,
          }),
        ),
      stopAll: () =>
        Effect.sync(() => {
          for (const ctx of sessions.values()) {
            ctx.closed = true;
            ctx.child.kill();
          }
          sessions.clear();
        }),
      streamEvents: Stream.fromPubSub(events),
    } satisfies PiAgentAdapterShape;
  });
}
