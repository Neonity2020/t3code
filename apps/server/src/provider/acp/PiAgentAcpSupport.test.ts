import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { homedir } from "node:os";
import {
  buildPiAgentAcpSpawnInput,
  makePiAgentAcpRuntime,
  PI_AGENT_ACP_UNSUPPORTED_DETAIL,
} from "./PiAgentAcpSupport.ts";

describe("buildPiAgentAcpSpawnInput", () => {
  it("expands a leading home-directory marker in the configured binary path", () => {
    const input = buildPiAgentAcpSpawnInput({ binaryPath: "~/.local/bin/pi" }, "/tmp/workspace");

    expect(input.command).toBe(`${homedir()}/.local/bin/pi`);
    expect(input.args).toEqual(["--mode", "rpc"]);
    expect(input.cwd).toBe("/tmp/workspace");
  });
});

describe("makePiAgentAcpRuntime", () => {
  it.effect("fails before spawning because the current Pi Agent CLI is not ACP-compatible", () =>
    Effect.gen(function* () {
      const exit = yield* makePiAgentAcpRuntime({
        childProcessSpawner: {} as never,
        piAgentSettings: { binaryPath: "pi" },
        cwd: "/tmp/workspace",
        clientInfo: { name: "t3-test", version: "0.0.0" },
      }).pipe(Effect.exit);

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        expect(String(exit.cause)).toContain(PI_AGENT_ACP_UNSUPPORTED_DETAIL);
      }
    }),
  );
});
