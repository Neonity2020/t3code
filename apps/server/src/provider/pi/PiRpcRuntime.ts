import { ProviderDriverKind, type ThreadId } from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ProviderAdapterProcessError, ProviderAdapterRequestError } from "../Errors.ts";

const PROVIDER = ProviderDriverKind.make("pi");

const PiUsage = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  totalTokens: Schema.Number,
});

const PiAssistantDelta = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text_start"), contentIndex: Schema.Number }),
  Schema.Struct({
    type: Schema.Literal("text_delta"),
    contentIndex: Schema.Number,
    delta: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("text_end"), contentIndex: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("thinking_start"), contentIndex: Schema.Number }),
  Schema.Struct({
    type: Schema.Literal("thinking_delta"),
    contentIndex: Schema.Number,
    delta: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("thinking_end"), contentIndex: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("toolcall_start"), contentIndex: Schema.Number }),
  Schema.Struct({
    type: Schema.Literal("toolcall_delta"),
    contentIndex: Schema.Number,
    delta: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("toolcall_end"),
    contentIndex: Schema.Number,
    toolCall: Schema.Unknown,
  }),
]);

const PiRpcResponse = Schema.Struct({
  id: Schema.optional(Schema.String),
  type: Schema.Literal("response"),
  command: Schema.String,
  success: Schema.Boolean,
  data: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
});
export type PiRpcResponse = typeof PiRpcResponse.Type;

const PiRpcEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("agent_start") }),
  Schema.Struct({ type: Schema.Literal("agent_end"), willRetry: Schema.optional(Schema.Boolean) }),
  Schema.Struct({ type: Schema.Literal("agent_settled") }),
  Schema.Struct({ type: Schema.Literal("turn_start") }),
  Schema.Struct({
    type: Schema.Literal("turn_end"),
    message: Schema.Unknown,
    toolResults: Schema.Array(Schema.Unknown),
  }),
  Schema.Struct({ type: Schema.Literal("message_start"), message: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal("message_end"), message: Schema.Unknown }),
  Schema.Struct({
    type: Schema.Literal("message_update"),
    usage: Schema.optional(PiUsage),
    assistantMessageEvent: PiAssistantDelta,
  }),
  Schema.Struct({
    type: Schema.Literal("tool_execution_start"),
    toolCallId: Schema.String,
    toolName: Schema.String,
    args: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal("tool_execution_update"),
    toolCallId: Schema.String,
    toolName: Schema.String,
    args: Schema.Unknown,
    partialResult: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal("tool_execution_end"),
    toolCallId: Schema.String,
    toolName: Schema.String,
    result: Schema.Unknown,
    isError: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("extension_ui_request"),
    id: Schema.String,
    method: Schema.String,
    title: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
    options: Schema.optional(Schema.Array(Schema.String)),
    placeholder: Schema.optional(Schema.String),
    prefill: Schema.optional(Schema.String),
  }),
]);
export type PiRpcEvent = typeof PiRpcEvent.Type;

const PiRpcOutput = Schema.Union([PiRpcResponse, PiRpcEvent]);
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeOutput = Schema.decodeUnknownEffect(PiRpcOutput);

export interface PiRpcCommand {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface PiRpcRuntime {
  readonly request: (
    command: PiRpcCommand,
  ) => Effect.Effect<PiRpcResponse, ProviderAdapterRequestError>;
  readonly notify: (command: PiRpcCommand) => Effect.Effect<void, ProviderAdapterRequestError>;
  readonly events: Stream.Stream<{ readonly event: PiRpcEvent; readonly raw: unknown }>;
  readonly stop: Effect.Effect<void>;
}

export const makePiRpcRuntime = Effect.fn("makePiRpcRuntime")(function* (input: {
  readonly binaryPath: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly threadId: ThreadId;
}): Effect.fn.Return<
  PiRpcRuntime,
  ProviderAdapterProcessError,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | Scope.Scope
> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const resolved = yield* resolveSpawnCommand(input.binaryPath || "pi", input.args, {
    env: input.env,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: input.threadId,
          detail: "Failed to resolve the Pi CLI command.",
          cause,
        }),
    ),
  );
  const handle = yield* spawner
    .spawn(
      ChildProcess.make(resolved.command, resolved.args, {
        cwd: input.cwd,
        env: input.env,
        shell: resolved.shell,
      }),
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: input.threadId,
            detail: "Failed to start Pi RPC mode.",
            cause,
          }),
      ),
    );

  const inputQueue = yield* Queue.unbounded<Uint8Array>();
  const eventBus = yield* PubSub.unbounded<{ readonly event: PiRpcEvent; readonly raw: unknown }>();
  const pending = new Map<string, Deferred.Deferred<PiRpcResponse, ProviderAdapterRequestError>>();
  const encoder = new TextEncoder();

  const writeFiber = yield* Stream.fromQueue(inputQueue).pipe(
    Stream.run(handle.stdin),
    Effect.mapError(
      (cause) =>
        new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: input.threadId,
          detail: "Pi RPC stdin failed.",
          cause,
        }),
    ),
    Effect.catch((cause) => Effect.logError(cause.message)),
    Effect.forkScoped,
  );

  let stdoutBuffer = "";
  const processLine = Effect.fn("PiRpcRuntime.processLine")(function* (line: string) {
    if (!line.trim()) return;
    const raw = yield* decodeJson(line).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Ignoring malformed Pi RPC output.", { cause }).pipe(
          Effect.as(undefined),
        ),
      ),
    );
    if (raw === undefined) return;
    const output = yield* decodeOutput(raw).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Ignoring unsupported Pi RPC output.", { cause }).pipe(
          Effect.as(undefined),
        ),
      ),
    );
    if (output === undefined) return;
    if (output.type === "response") {
      if (!output.id) return;
      const waiter = pending.get(output.id);
      if (!waiter) return;
      pending.delete(output.id);
      if (output.success) {
        yield* Deferred.succeed(waiter, output);
      } else {
        yield* Deferred.fail(
          waiter,
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: output.command,
            detail: output.error || "Pi rejected the RPC command.",
          }),
        );
      }
      return;
    }
    yield* PubSub.publish(eventBus, { event: output, raw }).pipe(Effect.asVoid);
  });

  const stdoutFiber = yield* handle.stdout.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) =>
      Effect.gen(function* () {
        stdoutBuffer += chunk;
        let newline = stdoutBuffer.indexOf("\n");
        while (newline >= 0) {
          const line = stdoutBuffer.slice(0, newline).replace(/\r$/, "");
          stdoutBuffer = stdoutBuffer.slice(newline + 1);
          yield* processLine(line);
          newline = stdoutBuffer.indexOf("\n");
        }
      }),
    ),
    Effect.andThen(
      Effect.suspend(() => {
        const line = stdoutBuffer.replace(/\r$/, "");
        stdoutBuffer = "";
        return line ? processLine(line) : Effect.void;
      }),
    ),
    Effect.catch((cause) => Effect.logError("Pi RPC stdout failed.", { cause })),
    Effect.forkScoped,
  );

  const send = (command: PiRpcCommand) =>
    Queue.offer(inputQueue, encoder.encode(`${JSON.stringify(command)}\n`)).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: command.type,
            detail: "Pi RPC input queue is closed.",
            cause,
          }),
      ),
      Effect.asVoid,
    );

  const failPending = (detail: string) =>
    Effect.gen(function* () {
      const waiters = Array.from(pending.values());
      pending.clear();
      yield* Effect.forEach(
        waiters,
        (waiter) =>
          Deferred.fail(
            waiter,
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "rpc",
              detail,
            }),
          ),
        { discard: true },
      );
    });

  const exitFiber = yield* handle.exitCode.pipe(
    Effect.flatMap((code) =>
      failPending(`Pi RPC process exited with code ${String(Number(code))}.`),
    ),
    Effect.ignore,
    Effect.forkScoped,
  );

  const request: PiRpcRuntime["request"] = (command) =>
    Effect.gen(function* () {
      const id = yield* crypto.randomUUIDv4.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: command.type,
              detail: "Failed to allocate a Pi RPC request id.",
              cause,
            }),
        ),
      );
      const waiter = yield* Deferred.make<PiRpcResponse, ProviderAdapterRequestError>();
      pending.set(id, waiter);
      yield* send({ ...command, id }).pipe(
        Effect.tapError(() => Effect.sync(() => pending.delete(id))),
      );
      return yield* Deferred.await(waiter).pipe(
        Effect.ensuring(Effect.sync(() => pending.delete(id))),
      );
    });

  const stop = Effect.gen(function* () {
    yield* failPending("Pi RPC runtime stopped.");
    yield* Queue.shutdown(inputQueue);
    yield* PubSub.shutdown(eventBus);
    yield* Fiber.interrupt(writeFiber);
    yield* Fiber.interrupt(stdoutFiber);
    yield* handle.kill().pipe(Effect.ignore);
    yield* Fiber.interrupt(exitFiber);
  });

  return {
    request,
    notify: send,
    events: Stream.fromPubSub(eventBus),
    stop,
  } satisfies PiRpcRuntime;
});
