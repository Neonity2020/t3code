import { type PiAgentSettings, ProviderDriverKind } from "@t3tools/contracts";
import { normalizeModelSlug } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpErrors from "effect-acp/errors";

import {
  AcpSessionRuntime,
  type AcpSessionRuntimeOptions,
  type AcpSessionRuntimeShape,
  type AcpSpawnInput,
} from "./AcpSessionRuntime.ts";
import { expandHomePath } from "../../pathExpansion.ts";

const PI_AGENT_DRIVER_KIND = ProviderDriverKind.make("piAgent");
const PI_AGENT_DEFAULT_MODEL = "auto";

type PiAgentAcpRuntimeSettings = Pick<PiAgentSettings, "binaryPath">;

export interface PiAgentAcpRuntimeInput extends Omit<
  AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly piAgentSettings: PiAgentAcpRuntimeSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface PiAgentAcpModelSelectionErrorContext {
  readonly cause: EffectAcpErrors.AcpError;
  readonly step: "set-model";
}

export function buildPiAgentAcpSpawnInput(
  piAgentSettings: PiAgentAcpRuntimeSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSpawnInput {
  const command = piAgentSettings?.binaryPath ? expandHomePath(piAgentSettings.binaryPath) : "pi";

  return {
    command,
    args: ["--mode", "rpc"],
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export const makePiAgentAcpRuntime = (
  input: PiAgentAcpRuntimeInput,
): Effect.Effect<AcpSessionRuntimeShape, EffectAcpErrors.AcpError, Scope.Scope> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildPiAgentAcpSpawnInput(input.piAgentSettings, input.cwd, input.environment),
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime).pipe(Effect.provide(acpContext));
  });

export function resolvePiAgentAcpBaseModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  if (!trimmed || trimmed === PI_AGENT_DEFAULT_MODEL) {
    return PI_AGENT_DEFAULT_MODEL;
  }
  return normalizeModelSlug(trimmed, PI_AGENT_DRIVER_KIND) ?? trimmed;
}

export function currentPiAgentModelIdFromSessionSetup(input: {
  readonly models?: { readonly currentModelId?: string | null | undefined } | null | undefined;
}): string | undefined {
  return input.models?.currentModelId?.trim() || undefined;
}

export function applyPiAgentAcpModelSelection<E>(input: {
  readonly runtime: {
    readonly setModel: (model: string) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
  };
  readonly currentModelId?: string | undefined;
  readonly model: string | null | undefined;
  readonly mapError: (context: PiAgentAcpModelSelectionErrorContext) => E;
}): Effect.Effect<void, E> {
  const resolvedModel = resolvePiAgentAcpBaseModelId(input.model);
  if (resolvedModel === PI_AGENT_DEFAULT_MODEL || resolvedModel === input.currentModelId) {
    return Effect.void;
  }
  return input.runtime.setModel(resolvedModel).pipe(
    Effect.mapError((cause) =>
      input.mapError({
        cause,
        step: "set-model",
      }),
    ),
    Effect.asVoid,
  );
}
