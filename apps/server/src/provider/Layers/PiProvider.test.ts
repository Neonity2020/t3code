import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { PiSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { parsePiModelSelection, parsePiResumeCursor } from "./PiAdapter.ts";
import { buildInitialPiProviderSnapshot, checkPiProviderStatus } from "./PiProvider.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);

describe("Pi provider", () => {
  it.effect("builds the default early-access snapshot", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialPiProviderSnapshot(decodePiSettings({}));

      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("warning");
      expect(snapshot.badgeLabel).toBe("Early Access");
      expect(snapshot.models.map((model) => model.slug)).toEqual(["default"]);
      expect(snapshot.requiresNewThreadForModelChange).toBe(false);
    }),
  );

  it("parses explicit Pi model selections and rejects the default placeholder", () => {
    expect(parsePiModelSelection("anthropic/claude-sonnet-4-5")).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
    });
    expect(parsePiModelSelection("default")).toBeUndefined();
    expect(parsePiModelSelection("missing-provider-separator")).toBeUndefined();
  });

  it("only accepts versioned, non-empty resume cursors", () => {
    expect(parsePiResumeCursor({ schemaVersion: 1, sessionFile: " /tmp/pi-session.jsonl " })).toBe(
      "/tmp/pi-session.jsonl",
    );
    expect(
      parsePiResumeCursor({ schemaVersion: 2, sessionFile: "/tmp/old.jsonl" }),
    ).toBeUndefined();
    expect(parsePiResumeCursor({ schemaVersion: 1, sessionFile: " " })).toBeUndefined();
  });
});

it.layer(NodeServices.layer)("checkPiProviderStatus", (it) => {
  it.effect("reports a missing Pi binary", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkPiProviderStatus(
        decodePiSettings({ binaryPath: "/definitely/not/installed/pi-binary" }),
      );

      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toContain("not installed");
    }),
  );
});
