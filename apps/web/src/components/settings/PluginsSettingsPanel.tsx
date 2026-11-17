import { BUILTIN_PLUGINS } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";

import { Button } from "../ui/button";
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function PluginsSettingsPanel() {
  return (
    <SettingsPageContainer>
      <SettingsSection id="built-in-plugins" title="Built-in plugins">
        {BUILTIN_PLUGINS.map((plugin) => {
          switch (plugin.id) {
            case "kanban":
              return <KanbanPluginRow key={plugin.id} />;
          }
        })}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function KanbanPluginRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("kanban-plugin")}
      settingKeys={["kanbanPluginEnabled"]}
      description="Plan tasks across Backlog, Todo, In Progress, Review, and Done, launch linked threads, and expose kanban MCP tools."
      control={
        <div className="flex items-center gap-2">
          {settings.kanbanPluginEnabled ? (
            <Button size="xs" variant="outline" render={<Link to="/kanban" />}>
              Open board
            </Button>
          ) : null}
          <ScopedSwitch
            settingKeys={["kanbanPluginEnabled"]}
            checked={settings.kanbanPluginEnabled}
            onCheckedChange={(checked) => updateSettings({ kanbanPluginEnabled: Boolean(checked) })}
            aria-label="Project Kanban board"
          />
        </div>
      }
    />
  );
}
