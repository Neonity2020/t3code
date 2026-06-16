import {
  type ModelCapabilities,
  type PiAgentSettings,
  ProviderDriverKind,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";

const PI_AGENT_PRESENTATION = {
  displayName: "Pi Agent",
  badgeLabel: "Early Access",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: true,
} as const;
const PROVIDER = ProviderDriverKind.make("piAgent");
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});
const VERSION_PROBE_TIMEOUT_MS = 4_000;
const PI_AGENT_RPC_MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
const encodePiAgentRpcCommand = Schema.encodeSync(Schema.UnknownFromJsonString);
const decodePiAgentRpcResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

class PiAgentRpcProbeError extends Data.TaggedError("PiAgentRpcProbeError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const PI_AGENT_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "auto",
    name: "Auto",
    isCustom: false,
    capabilities: EMPTY_CAPABILITIES,
  },
  {
    slug: "agnes-2.0-flash",
    name: "Agnes 2.0 Flash",
    isCustom: false,
    capabilities: EMPTY_CAPABILITIES,
  },
];

function piAgentModelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
  builtInModels: ReadonlyArray<ServerProviderModel> = PI_AGENT_BUILT_IN_MODELS,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    builtInModels,
    PROVIDER,
    customModels ?? [],
    EMPTY_CAPABILITIES,
  );
}

export function buildInitialPiAgentProviderSnapshot(
  piAgentSettings: PiAgentSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = piAgentModelsFromSettings(piAgentSettings.customModels);

    if (!piAgentSettings.enabled) {
      return buildServerProvider({
        presentation: PI_AGENT_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Pi Agent is disabled in T3 Code settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: PI_AGENT_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "unknown" },
        message: "Checking Pi Agent availability...",
      },
    });
  });
}

interface PiAgentRpcResponse {
  readonly type?: unknown;
  readonly command?: unknown;
  readonly success?: unknown;
  readonly data?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildPiAgentDiscoveredModelsFromRpcResponse(
  response: unknown,
): ReadonlyArray<ServerProviderModel> {
  if (!isRecord(response)) return [];
  const rpcResponse = response as PiAgentRpcResponse;
  if (
    rpcResponse.type !== "response" ||
    rpcResponse.command !== "get_available_models" ||
    rpcResponse.success !== true ||
    !isRecord(rpcResponse.data) ||
    !Array.isArray(rpcResponse.data.models)
  ) {
    return [];
  }
  const seen = new Set<string>();
  return rpcResponse.data.models
    .map((model): ServerProviderModel | undefined => {
      if (!isRecord(model)) return undefined;
      const modelId = typeof model.id === "string" ? model.id.trim() : "";
      const provider = typeof model.provider === "string" ? model.provider.trim() : "";
      const slug = provider && modelId ? `${provider}/${modelId}` : modelId;
      if (!slug || seen.has(slug)) {
        return undefined;
      }
      seen.add(slug);
      const name = typeof model.name === "string" ? model.name.trim() : "";
      return {
        slug,
        name: name || slug,
        isCustom: false,
        capabilities: EMPTY_CAPABILITIES,
      };
    })
    .filter((model): model is ServerProviderModel => model !== undefined);
}

const discoverPiAgentModelsViaRpc = (
  piAgentSettings: PiAgentSettings,
  environment: NodeJS.ProcessEnv = process.env,
) =>
  Effect.gen(function* () {
    const command = piAgentSettings.binaryPath || "pi";
    const args = ["--mode", "rpc", "--no-session"] as const;
    const spawnCommand = yield* resolveSpawnCommand(command, args, {
      env: environment,
    });
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
        stdin: {
          stream: Stream.encodeText(
            Stream.make(
              `${encodePiAgentRpcCommand({ id: "t3-models", type: "get_available_models" })}\n`,
            ),
          ),
        },
      }),
    );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        Stream.runCollect(child.stdout).pipe(
          Effect.map((chunks) => Buffer.concat(Array.from(chunks)).toString("utf8")),
        ),
        Stream.runCollect(child.stderr).pipe(
          Effect.map((chunks) => Buffer.concat(Array.from(chunks)).toString("utf8")),
        ),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );
    if (exitCode !== 0) {
      return yield* new PiAgentRpcProbeError({
        message: detailFromResult({ stdout, stderr, code: exitCode }) ?? "Pi Agent RPC failed.",
      });
    }
    const firstResponseLine = stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (!firstResponseLine) return [];
    const parsed = yield* decodePiAgentRpcResponse(firstResponseLine).pipe(
      Effect.mapError(
        (cause) =>
          new PiAgentRpcProbeError({
            message: "Pi Agent RPC returned invalid JSON.",
            cause,
          }),
      ),
    );
    return buildPiAgentDiscoveredModelsFromRpcResponse(parsed);
  }).pipe(Effect.scoped);

const runPiAgentVersionCommand = (
  piAgentSettings: PiAgentSettings,
  environment: NodeJS.ProcessEnv = process.env,
) =>
  Effect.gen(function* () {
    const command = piAgentSettings.binaryPath || "pi";
    const spawnCommand = yield* resolveSpawnCommand(command, ["--version"], {
      env: environment,
    });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
  });

export const checkPiAgentProviderStatus = Effect.fn("checkPiAgentProviderStatus")(function* (
  piAgentSettings: PiAgentSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = piAgentModelsFromSettings(piAgentSettings.customModels);

  if (!piAgentSettings.enabled) {
    return buildServerProvider({
      presentation: PI_AGENT_PRESENTATION,
      enabled: false,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Pi Agent is disabled in T3 Code settings.",
      },
    });
  }

  const versionResult = yield* runPiAgentVersionCommand(piAgentSettings, environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionResult)) {
    const error = versionResult.failure;
    return buildServerProvider({
      presentation: PI_AGENT_PRESENTATION,
      enabled: piAgentSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Pi Agent (`pi`) is not installed or not on PATH."
          : `Failed to execute Pi Agent health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionResult.success)) {
    return buildServerProvider({
      presentation: PI_AGENT_PRESENTATION,
      enabled: piAgentSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "unknown" },
        message: "Pi Agent is installed but timed out while running `pi --version`.",
      },
    });
  }

  const versionOutput = versionResult.success.value;
  const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    const detail = detailFromResult(versionOutput);
    return buildServerProvider({
      presentation: PI_AGENT_PRESENTATION,
      enabled: piAgentSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "ready",
        auth: { status: "unknown" },
        message: detail
          ? `Pi Agent is installed but failed to run. ${detail}`
          : "Pi Agent is installed but failed to run.",
      },
    });
  }

  const discoveryExit = yield* discoverPiAgentModelsViaRpc(piAgentSettings, environment).pipe(
    Effect.timeoutOption(PI_AGENT_RPC_MODEL_DISCOVERY_TIMEOUT_MS),
    Effect.exit,
  );
  if (Exit.isFailure(discoveryExit)) {
    const detail = Cause.pretty(discoveryExit.cause);
    yield* Effect.logWarning("Pi Agent RPC model discovery failed", { cause: detail });
    return buildServerProvider({
      presentation: PI_AGENT_PRESENTATION,
      enabled: piAgentSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "ready",
        auth: { status: "unknown" },
        message: `Pi Agent is installed but RPC model discovery failed. ${detail}`,
      },
    });
  }

  if (Option.isNone(discoveryExit.value)) {
    yield* Effect.logWarning(
      `Pi Agent RPC model discovery timed out after ${PI_AGENT_RPC_MODEL_DISCOVERY_TIMEOUT_MS}ms.`,
    );
    return buildServerProvider({
      presentation: PI_AGENT_PRESENTATION,
      enabled: piAgentSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "ready",
        auth: { status: "unknown" },
        message: `Pi Agent is installed but RPC model discovery timed out after ${PI_AGENT_RPC_MODEL_DISCOVERY_TIMEOUT_MS}ms.`,
      },
    });
  }

  const discoveredModels = discoveryExit.value.value;
  const models =
    discoveredModels.length > 0
      ? piAgentModelsFromSettings(piAgentSettings.customModels, discoveredModels)
      : fallbackModels;

  return buildServerProvider({
    presentation: PI_AGENT_PRESENTATION,
    enabled: piAgentSettings.enabled,
    checkedAt,
    models,
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: { status: "unknown" },
    },
  });
});

export const enrichPiAgentSnapshot = (input: {
  readonly snapshot: ServerProvider;
  readonly maintenanceCapabilities: ProviderMaintenanceCapabilities;
  readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
  readonly httpClient: HttpClient.HttpClient;
}): Effect.Effect<void> => {
  const { snapshot, publishSnapshot } = input;

  return enrichProviderSnapshotWithVersionAdvisory(snapshot, input.maintenanceCapabilities).pipe(
    Effect.provideService(HttpClient.HttpClient, input.httpClient),
    Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
    Effect.catchCause((cause) =>
      Effect.logWarning("Pi Agent version advisory enrichment failed", {
        cause: Cause.pretty(cause),
      }),
    ),
    Effect.asVoid,
  );
};
