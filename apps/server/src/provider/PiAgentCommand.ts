// @effect-diagnostics nodeBuiltinImport:off
import { accessSync, constants, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { expandHomePath } from "../pathExpansion.ts";

export interface PiAgentCommandResolutionOptions {
  readonly homeDirectory?: string;
  readonly isExecutable?: (path: string) => boolean;
  readonly listDirectory?: (path: string) => ReadonlyArray<string>;
}

export interface PiAgentCommandSettings {
  readonly binaryPath?: string | null | undefined;
}

const PI_AGENT_COMMAND = "pi";

function isExecutablePath(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function listDirectoryEntries(path: string): ReadonlyArray<string> {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function compareVersionDirectoryDesc(left: string, right: string): number {
  const leftParts = left
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  const rightParts = right
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    const leftValue = leftPart === undefined || Number.isNaN(leftPart) ? 0 : leftPart;
    const rightValue = rightPart === undefined || Number.isNaN(rightPart) ? 0 : rightPart;
    if (leftValue !== rightValue) return rightValue - leftValue;
  }
  return right.localeCompare(left);
}

function discoverPiAgentCandidatePaths(
  options: Required<PiAgentCommandResolutionOptions>,
): ReadonlyArray<string> {
  const nvmNodeVersionsDirectory = join(options.homeDirectory, ".nvm", "versions", "node");
  const nvmCandidates = options
    .listDirectory(nvmNodeVersionsDirectory)
    .filter((entry) => entry.startsWith("v"))
    .toSorted(compareVersionDirectoryDesc)
    .map((entry) => join(nvmNodeVersionsDirectory, entry, "bin", PI_AGENT_COMMAND));

  return [
    ...nvmCandidates,
    join(options.homeDirectory, ".bun", "bin", PI_AGENT_COMMAND),
    join(options.homeDirectory, ".local", "bin", PI_AGENT_COMMAND),
    join(options.homeDirectory, "Library", "pnpm", PI_AGENT_COMMAND),
    join(options.homeDirectory, ".vite-plus", "bin", PI_AGENT_COMMAND),
  ];
}

export function resolvePiAgentCommandPath(
  settings: PiAgentCommandSettings | null | undefined,
  options: PiAgentCommandResolutionOptions = {},
): string {
  const configuredBinaryPath = settings?.binaryPath?.trim() ?? "";
  if (configuredBinaryPath && configuredBinaryPath !== PI_AGENT_COMMAND) {
    return expandHomePath(configuredBinaryPath);
  }

  const resolutionOptions: Required<PiAgentCommandResolutionOptions> = {
    homeDirectory: options.homeDirectory ?? homedir(),
    isExecutable: options.isExecutable ?? isExecutablePath,
    listDirectory: options.listDirectory ?? listDirectoryEntries,
  };
  return (
    discoverPiAgentCandidatePaths(resolutionOptions).find((candidate) =>
      resolutionOptions.isExecutable(candidate),
    ) ?? PI_AGENT_COMMAND
  );
}
