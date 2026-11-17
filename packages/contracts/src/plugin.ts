import * as Schema from "effect/Schema";

import type { ProjectId } from "./baseSchemas.ts";
import type { ServerSettings } from "./settings.ts";

const BUILTIN_PLUGIN_IDS = ["kanban"] as const;
export const BuiltinPluginId = Schema.Literals(BUILTIN_PLUGIN_IDS);
export type BuiltinPluginId = typeof BuiltinPluginId.Type;

export interface BuiltinPluginDefinition {
  readonly id: BuiltinPluginId;
  readonly settingKey: "kanbanPluginEnabled";
  readonly defaultEnabled: boolean;
}

export const BUILTIN_PLUGINS: ReadonlyArray<BuiltinPluginDefinition> = [
  {
    id: "kanban",
    settingKey: "kanbanPluginEnabled",
    defaultEnabled: true,
  },
];

export function resolveBuiltinPluginEnabled(
  settings: Pick<ServerSettings, "kanbanPluginEnabled" | "projectSettingsOverrides">,
  pluginId: BuiltinPluginId,
  projectId: ProjectId | null = null,
): boolean {
  switch (pluginId) {
    case "kanban": {
      if (projectId !== null) {
        const override = settings.projectSettingsOverrides[projectId]?.kanbanPluginEnabled;
        if (override !== undefined) return override;
      }
      return settings.kanbanPluginEnabled;
    }
  }
}
