// @effect-diagnostics nodeBuiltinImport:off
import { describe, expect, it } from "@effect/vitest";
import { homedir } from "node:os";
import { join } from "node:path";

import { resolvePiAgentCommandPath } from "./PiAgentCommand.ts";

describe("resolvePiAgentCommandPath", () => {
  it("expands an explicitly configured home-directory path", () => {
    expect(resolvePiAgentCommandPath({ binaryPath: "~/.local/bin/pi" })).toBe(
      join(homedir(), ".local", "bin", "pi"),
    );
  });

  it("keeps an explicitly configured non-default command", () => {
    expect(resolvePiAgentCommandPath({ binaryPath: "/opt/pi/bin/pi" })).toBe("/opt/pi/bin/pi");
  });

  it("resolves the default command from a user bun installation", () => {
    const homeDirectory = "/Users/tester";
    const bunPi = join(homeDirectory, ".bun", "bin", "pi");

    expect(
      resolvePiAgentCommandPath(
        { binaryPath: "pi" },
        {
          homeDirectory,
          isExecutable: (path) => path === bunPi,
          listDirectory: () => [],
        },
      ),
    ).toBe(bunPi);
  });

  it("resolves the default command from the newest nvm node installation", () => {
    const homeDirectory = "/Users/tester";
    const newestPi = join(homeDirectory, ".nvm", "versions", "node", "v22.19.0", "bin", "pi");

    expect(
      resolvePiAgentCommandPath(
        {},
        {
          homeDirectory,
          isExecutable: (path) => path === newestPi,
          listDirectory: (path) =>
            path.endsWith("/.nvm/versions/node") ? ["v20.1.0", "v22.19.0", "v18.9.0"] : [],
        },
      ),
    ).toBe(newestPi);
  });

  it("keeps the default command when no user installation is found", () => {
    expect(
      resolvePiAgentCommandPath(
        {},
        {
          homeDirectory: "/Users/tester",
          isExecutable: () => false,
          listDirectory: () => [],
        },
      ),
    ).toBe("pi");
  });
});
