import { BUILTIN_PLUGINS } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { T, useGT, useMessages } from "gt-react";

import { Button } from "../ui/button";
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function PluginsSettingsPanel() {
  const gt = useGT();
  return (
    <SettingsPageContainer>
      <SettingsSection id="built-in-plugins" title={gt("Built-in plugins")}>
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
  const gt = useGT();
  const m = useMessages();
  const setting = searchableSetting("kanban-plugin");
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsRow
      serverScoped
      id={setting.id}
      title={m(setting.title)}
      settingKeys={["kanbanPluginEnabled"]}
      description={
        <T>
          Plan tasks across Backlog, Todo, In Progress, Review, and Done, launch linked threads, and
          expose kanban MCP tools.
        </T>
      }
      control={
        <div className="flex items-center gap-2">
          {settings.kanbanPluginEnabled ? (
            <Button size="xs" variant="outline" render={<Link to="/kanban" />}>
              <T>Open board</T>
            </Button>
          ) : null}
          <ScopedSwitch
            settingKeys={["kanbanPluginEnabled"]}
            checked={settings.kanbanPluginEnabled}
            onCheckedChange={(checked) => updateSettings({ kanbanPluginEnabled: Boolean(checked) })}
            aria-label={gt("Project Kanban board")}
          />
        </div>
      }
    />
  );
}
