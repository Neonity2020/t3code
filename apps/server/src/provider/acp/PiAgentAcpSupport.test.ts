import { describe, expect, it } from "@effect/vitest";
import { homedir } from "node:os";
import { buildPiAgentAcpSpawnInput } from "./PiAgentAcpSupport.ts";

describe("buildPiAgentAcpSpawnInput", () => {
  it("expands a leading home-directory marker in the configured binary path", () => {
    const input = buildPiAgentAcpSpawnInput({ binaryPath: "~/.local/bin/pi" }, "/tmp/workspace");

    expect(input.command).toBe(`${homedir()}/.local/bin/pi`);
    expect(input.args).toEqual(["--mode", "rpc"]);
    expect(input.cwd).toBe("/tmp/workspace");
  });
});
