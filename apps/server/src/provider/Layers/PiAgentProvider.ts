// @ts-nocheck
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import {
  type ModelCapabilities,
  type PiAgentSettings,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
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
  displayName: "Pi Agent",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: true,
} as const;

const PI_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });

const effectivePiBinaryPath = (configuredPath: string): string => {
  if (configuredPath !== "pi") return configuredPath;
  const bunPi = join(homedir(), ".bun", "bin", "pi");
  return existsSync(bunPi) ? bunPi : configuredPath;
};

const piModels = (settings: PiAgentSettings): ReadonlyArray<ServerProviderModel> =>
  providerModelsFromSettings([], settings.customModels, PI_MODEL_CAPABILITIES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Convert Pi's RPC model catalogue into composer-safe, provider-qualified slugs. */
export function piModelsFromRpcResponse(response: unknown): ReadonlyArray<ServerProviderModel> {
  if (!isRecord(response) || !isRecord(response.data) || !Array.isArray(response.data.models)) {
    return [];
  }
  const seen = new Set<string>();
  return response.data.models.flatMap((candidate): Array<ServerProviderModel> => {
    if (
      !isRecord(candidate) ||
      typeof candidate.provider !== "string" ||
      typeof candidate.id !== "string"
    ) {
      return [];
    }
    const provider = candidate.provider.trim();
    const id = candidate.id.trim();
    const slug = provider && id ? `${provider}/${id}` : "";
    if (!slug || seen.has(slug)) return [];
    seen.add(slug);
    const modelName =
      typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : id;
    return [
      {
        slug,
        name: `${modelName} (${provider})`,
        isCustom: false,
        capabilities: PI_MODEL_CAPABILITIES,
      },
    ];
  });
}

function discoverPiModels(
  binaryPath: string,
  environment: NodeJS.ProcessEnv,
): Promise<ReadonlyArray<ServerProviderModel>> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, ["--mode", "rpc", "--no-approve"], {
      cwd: process.cwd(),
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    let settled = false;
    const finish = (result: ReadonlyArray<ServerProviderModel> | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      result instanceof Error ? reject(result) : resolve(result);
    };
    const send = (value: Record<string, unknown>) =>
      child.stdin?.write(`${JSON.stringify(value)}\n`);
    const timeout = setTimeout(
      () => finish(new Error("Timed out while loading Pi Agent models.")),
      10_000,
    );
    child.on("error", (error) => finish(error));
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        try {
          const record: unknown = JSON.parse(line);
          if (!isRecord(record)) continue;
          if (record.type === "extension_ui_request" && typeof record.id === "string") {
            send({ type: "extension_ui_response", id: record.id, cancelled: true });
          }
          if (record.type === "response" && record.id === "pi-models") {
            finish(piModelsFromRpcResponse(record));
          }
        } catch {
          // Pi stderr is diagnostics; malformed stdout records are ignored until timeout.
        }
      }
    });
    send({ id: "pi-models", type: "get_available_models" });
  });
}

export function makePendingPiAgentProvider(
  settings: PiAgentSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models: piModels(settings),
      probe: settings.enabled
        ? {
            installed: true,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Checking Pi Agent availability...",
          }
        : {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Pi Agent is disabled in T3 Code settings.",
          },
    });
  });
}

export const checkPiAgentProviderStatus = Effect.fn("checkPiAgentProviderStatus")(function* (
  settings: PiAgentSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const models = piModels(settings);
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
        message: "Pi Agent is disabled in T3 Code settings.",
      },
    });
  }

  const binaryPath = effectivePiBinaryPath(settings.binaryPath);
  const spawnCommand = yield* resolveSpawnCommand(binaryPath, ["--version"], {
    env: environment,
  });
  const result = yield* spawnAndCollect(
    binaryPath,
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      env: environment,
      shell: spawnCommand.shell,
    }),
  ).pipe(Effect.result);
  if (Result.isFailure(result)) {
    const message = isCommandMissingCause(result.failure)
      ? "Pi Agent CLI (`pi`) is not installed or not on PATH."
      : `Failed to execute Pi Agent CLI health check: ${result.failure.message}`;
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
        message,
      },
    });
  }
  const version = parseGenericCliVersion(`${result.success.stdout}\n${result.success.stderr}`);
  const discoveredModels = yield* Effect.promise(() =>
    discoverPiModels(binaryPath, environment),
  ).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<ServerProviderModel>));
  return buildServerProvider({
    presentation: PI_PRESENTATION,
    enabled: true,
    checkedAt,
    models: providerModelsFromSettings(
      discoveredModels,
      settings.customModels,
      PI_MODEL_CAPABILITIES,
    ),
    probe: {
      installed: true,
      version,
      status: result.success.code === 0 ? "ready" : "error",
      auth: { status: "unknown" },
      ...(result.success.code === 0
        ? {}
        : { message: result.success.stderr.trim() || "Pi Agent version command failed." }),
    },
  });
});
