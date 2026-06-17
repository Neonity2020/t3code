/**
 * PiAgentAdapter — shape type for the Pi Agent provider adapter.
 *
 * Pi Agent currently exposes a native JSONL RPC protocol over `pi --mode rpc`.
 * The adapter implementation owns that subprocess protocol directly instead
 * of going through ACP.
 *
 * @module PiAgentAdapter
 */
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface PiAgentAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}
