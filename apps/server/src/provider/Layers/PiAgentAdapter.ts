import {
  type CursorSettings,
  type PiAgentSettings,
  ProviderDriverKind,
  type ProviderOptionSelection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as EffectAcpErrors from "effect-acp/errors";

import {
  applyPiAgentAcpModelSelection,
  makePiAgentAcpRuntime,
  resolvePiAgentAcpBaseModelId,
} from "../acp/PiAgentAcpSupport.ts";
import { type AcpSessionRuntimeShape } from "../acp/AcpSessionRuntime.ts";
import type { CursorAcpModelSelectionErrorContext } from "../acp/CursorAcpSupport.ts";
import { makeCursorAdapter, type CursorAdapterLiveOptions } from "./CursorAdapter.ts";

const PROVIDER = ProviderDriverKind.make("piAgent");

function toCursorCompatibleSettings(settings: PiAgentSettings): CursorSettings {
  return {
    enabled: settings.enabled,
    binaryPath: settings.binaryPath,
    apiEndpoint: "",
    customModels: settings.customModels,
  };
}

export function makePiAgentAdapter(
  piAgentSettings: PiAgentSettings,
  options?: Omit<
    CursorAdapterLiveOptions,
    | "applyModelSelection"
    | "enableCursorExtensions"
    | "makeRuntime"
    | "providerDisplayName"
    | "providerKind"
    | "resolveModelId"
    | "resolveSettings"
  >,
) {
  return makeCursorAdapter(toCursorCompatibleSettings(piAgentSettings), {
    ...options,
    providerKind: PROVIDER,
    providerDisplayName: "Pi Agent",
    enableCursorExtensions: false,
    resolveModelId: resolvePiAgentAcpBaseModelId,
    makeRuntime: (input) =>
      makePiAgentAcpRuntime({
        ...input,
        piAgentSettings,
      }),
    applyModelSelection: <E>(input: {
      readonly runtime: {
        readonly getConfigOptions: AcpSessionRuntimeShape["getConfigOptions"];
        readonly setConfigOption: (
          configId: string,
          value: string | boolean,
        ) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
        readonly setModel: (model: string) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
      };
      readonly model: string | null | undefined;
      readonly selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
      readonly mapError: (context: CursorAcpModelSelectionErrorContext) => E;
    }) =>
      applyPiAgentAcpModelSelection({
        runtime: input.runtime,
        currentModelId: undefined,
        model: input.model,
        mapError: input.mapError,
      }),
  });
}
