import { decodeMsg, decodeOptions } from "gt-react";
import { ProviderDriverKind, type ManagedPolicySummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { managedInstanceLocks, managedTelemetryOffMessage } from "./managedPolicy";

const codex = ProviderDriverKind.make("codex");
const claude = ProviderDriverKind.make("claudeAgent");

const policy: ManagedPolicySummary = {
  organization: "Example Corp",
  lockedSettings: [],
  limits: {
    providers: {
      lockedInstanceFields: {
        [codex]: ["config.binaryPath", "environment.OPENAI_BASE_URL", "environment.HTTPS_PROXY"],
      },
    },
  },
};

describe("managedInstanceLocks", () => {
  it("splits locked instance paths into config keys and environment names", () => {
    const locks = managedInstanceLocks(policy, codex);
    expect(locks && [...locks.configKeys]).toEqual(["binaryPath"]);
    expect(locks && [...locks.environmentNames]).toEqual(["OPENAI_BASE_URL", "HTTPS_PROXY"]);
    expect(locks?.reason).toBe("Managed by Example Corp.");
  });

  it("treats a bare environment path as every variable", () => {
    const ceilingPolicy = {
      ...policy,
      limits: {
        providers: { lockedInstanceFields: { [codex]: ["config.binaryPath", "environment"] } },
      },
    };
    const locks = managedInstanceLocks(ceilingPolicy, codex);
    expect(locks?.wholeEnvironment).toBe(true);
    expect(managedInstanceLocks(policy, codex)?.wholeEnvironment).toBe(false);
  });

  it("locks nothing for drivers the policy does not pin, or without a policy", () => {
    expect(managedInstanceLocks(policy, claude)).toBeUndefined();
    expect(managedInstanceLocks(undefined, codex)).toBeUndefined();
  });
});

describe("managedTelemetryOffMessage", () => {
  it("encodes a translatable organization message only when telemetry is disabled", () => {
    expect(managedTelemetryOffMessage(undefined)).toBeUndefined();
    expect(managedTelemetryOffMessage(policy)).toBeUndefined();

    const message = managedTelemetryOffMessage({
      ...policy,
      limits: { telemetry: false },
    });
    expect(message).toBeDefined();
    expect(decodeMsg(message!)).toBe("Example Corp turned off anonymous usage data.");
    expect(decodeOptions(message!)).toMatchObject({
      organization: "Example Corp",
      $_source: "{organization} turned off anonymous usage data.",
    });
  });
});
