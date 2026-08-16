import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { makePiRpcRuntime } from "./PiRpcRuntime.ts";

it.layer(NodeServices.layer)("PiRpcRuntime", (it) => {
  it.effect(
    "correlates responses and preserves Unicode separators inside strict JSONL records",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-pi-rpc-" });
          const mockPath = path.join(cwd, "mock-pi.mjs");
          yield* fs.writeFileString(
            mockPath,
            [
              'let buffer = "";',
              'process.stdin.setEncoding("utf8");',
              'process.stdin.on("data", (chunk) => {',
              "  buffer += chunk;",
              '  let newline = buffer.indexOf("\\n");',
              "  while (newline >= 0) {",
              "    const command = JSON.parse(buffer.slice(0, newline));",
              "    buffer = buffer.slice(newline + 1);",
              '    process.stdout.write(JSON.stringify({ type: "message_update", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 }, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "left\\u2028right" } }) + "\\n");',
              '    process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: command.type, success: true, data: { ok: true } }) + "\\n");',
              "    newline = buffer.indexOf('\\n');",
              "  }",
              "});",
            ].join("\n"),
          );

          const runtime = yield* makePiRpcRuntime({
            binaryPath: process.execPath,
            args: [mockPath],
            cwd,
            env: process.env,
            threadId: ThreadId.make("thread-pi-rpc"),
          });
          const eventFiber = yield* runtime.events.pipe(Stream.runHead, Effect.forkScoped);
          const response = yield* runtime.request({ type: "get_state" });
          const event = yield* Fiber.join(eventFiber);

          expect(response.data).toEqual({ ok: true });
          expect(Option.getOrThrow(event).event).toMatchObject({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "left\u2028right" },
          });
          yield* runtime.stop;
        }),
      ),
  );

  it.effect("fails outstanding requests when the Pi process exits", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-pi-rpc-exit-" });
        const mockPath = path.join(cwd, "mock-pi-exit.mjs");
        yield* fs.writeFileString(mockPath, 'process.stdin.once("data", () => process.exit(7));\n');

        const runtime = yield* makePiRpcRuntime({
          binaryPath: process.execPath,
          args: [mockPath],
          cwd,
          env: process.env,
          threadId: ThreadId.make("thread-pi-rpc-exit"),
        });
        const error = yield* runtime.request({ type: "get_state" }).pipe(Effect.flip);

        expect(error.detail).toContain("exited with code 7");
      }),
    ),
  );
});
