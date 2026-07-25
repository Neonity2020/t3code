import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/** Per-instance adapter contract for Pi's local RPC process. */
export interface PiAgentAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}
