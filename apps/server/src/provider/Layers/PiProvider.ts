import { type PiSettings, type ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const PI_PRESENTATION = {
  displayName: "Pi",
  badgeLabel: "Early Access",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: false,
} as const;

const EMPTY_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });
const VERSION_PROBE_TIMEOUT_MS = 4_000;
const DEFAULT_MODEL: ServerProviderModel = {
  slug: "default",
  name: "Pi default model",
  isCustom: false,
  capabilities: EMPTY_CAPABILITIES,
};

function modelsFromSettings(
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings([DEFAULT_MODEL], customModels, EMPTY_CAPABILITIES);
}

export const buildInitialPiProviderSnapshot = Effect.fn("buildInitialPiProviderSnapshot")(
  function* (settings: PiSettings): Effect.fn.Return<ServerProviderDraft> {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models: modelsFromSettings(settings.customModels),
      probe: settings.enabled
        ? {
            installed: true,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Checking Pi CLI availability...",
          }
        : {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Pi is disabled in T3 Code settings.",
          },
    });
  },
);

const runVersionCommand = (settings: PiSettings, environment: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const command = settings.binaryPath || "pi";
    const resolved = yield* resolveSpawnCommand(command, ["--version"], { env: environment });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(resolved.command, resolved.args, {
        env: environment,
        shell: resolved.shell,
      }),
    );
  });

export const checkPiProviderStatus = Effect.fn("checkPiProviderStatus")(function* (
  settings: PiSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const models = modelsFromSettings(settings.customModels);
  if (!settings.enabled) {
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Pi is disabled in T3 Code settings.",
      },
    });
  }

  const result = yield* runVersionCommand(settings, environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(result)) {
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: !isCommandMissingCause(result.failure),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(result.failure)
          ? "Pi CLI (`pi`) is not installed or not on PATH."
          : "Failed to execute the Pi CLI health check.",
      },
    });
  }
  if (Option.isNone(result.success)) {
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Pi CLI timed out while running `pi --version`.",
      },
    });
  }

  const output = result.success.value;
  const version = parseGenericCliVersion(`${output.stdout}\n${output.stderr}`);
  return buildServerProvider({
    presentation: PI_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version,
      status: output.code === 0 ? "ready" : "error",
      auth: { status: "unknown" },
      ...(output.code === 0 ? {} : { message: "Pi CLI is installed but failed to run." }),
    },
  });
});
