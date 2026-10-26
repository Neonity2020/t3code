import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  desktopCliCommandStateAtom,
  getDesktopCliCommandBridge,
  refreshDesktopCliCommandState,
} from "~/state/desktopCliCommand";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function CliCommandSettingsRow() {
  const { t } = useTranslation();
  const bridge = getDesktopCliCommandBridge();
  const query = useEnvironmentQuery(bridge ? desktopCliCommandStateAtom : null);
  const state = query.data;
  const [pending, setPending] = useState(false);

  const change = (action: "install" | "uninstall") => {
    if (!bridge || pending) return;
    setPending(true);
    void bridge[action]()
      .then(refreshDesktopCliCommandState)
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title:
              action === "install"
                ? t("settings.cli.couldNotInstall")
                : t("settings.cli.couldNotRemove"),
            description: error instanceof Error ? error.message : t("settings.cli.genericError"),
          }),
        );
      })
      .finally(() => setPending(false));
  };

  if (!bridge || !state?.supported) return null;
  const installed = state.installedPath !== null;
  const description = state.shadowedBy
    ? t("settings.cli.shadowed", { path: state.shadowedBy })
    : !installed
      ? t("settings.cli.notInstalled")
      : state.onPath
        ? t("settings.cli.installed", { path: state.installedPath })
        : t("settings.cli.notOnPath", { path: state.installedPath });

  return (
    <SettingsRow
      {...searchableSetting("cli-command")}
      description={description}
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={pending || query.isPending}
          onClick={() => change(installed ? "uninstall" : "install")}
        >
          {installed ? t("settings.cli.remove") : t("settings.cli.install")}
        </Button>
      }
    />
  );
}
