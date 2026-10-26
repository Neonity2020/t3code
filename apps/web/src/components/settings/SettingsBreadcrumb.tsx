import { useTranslation } from "react-i18next";
import { settingsSectionKey } from "~/i18n";

import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { SETTINGS_SECTION_LABELS } from "./settingsSearch";
import type { SettingsPath } from "./settingsSearch";

const SETTINGS_BREADCRUMB_PATHS: ReadonlySet<string> = new Set([
  ...Object.keys(SETTINGS_SECTION_LABELS),
  "/settings/open-source-licenses",
]);

function normalizeSettingsPathname(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export function SettingsBreadcrumb({ pathname }: { pathname: string }) {
  const { t } = useTranslation();
  const normalizedPathname = normalizeSettingsPathname(pathname);
  const hasSection = SETTINGS_BREADCRUMB_PATHS.has(normalizedPathname);
  const sectionLabel = hasSection
    ? t(settingsSectionKey(normalizedPathname), {
        defaultValue: SETTINGS_SECTION_LABELS[normalizedPathname as SettingsPath],
      })
    : null;
  const rootLabel = t("settings.breadcrumbRoot", { defaultValue: "Settings" });

  return (
    <WorkspaceBreadcrumb ariaLabel={rootLabel}>
      {sectionLabel ? (
        <>
          <WorkspaceBreadcrumbItem>{rootLabel}</WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
        </>
      ) : null}
      <WorkspaceBreadcrumbItem current className="truncate">
        {sectionLabel ?? rootLabel}
      </WorkspaceBreadcrumbItem>
    </WorkspaceBreadcrumb>
  );
}
