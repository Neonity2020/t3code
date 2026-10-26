import type {
  StorageCleanupReport,
  StorageCleanupSettings,
  WorktreeCleanupRules,
} from "@t3tools/contracts";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { formatBytes } from "../../lib/formatBytes";
import i18next from "~/i18n";
import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { useNowMinute } from "../../hooks/useNowMinute";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { DatabaseStorageNotice } from "./DatabaseStorageNotice";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { SettingsGroup } from "./SettingsGroup";
import type { ScopedSettingsTarget } from "./scopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useClearScopedSettings,
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { settingsScopeEnvironmentLabel } from "./settingsScopeAxis";

function WorktreesDirectoryRow() {
  const { t } = useTranslation();
  const { connectedEnvironments, targets } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["worktreesDirectory"]);
  const edited = useRef(false);
  if (
    connectedEnvironments.some(
      (environment) =>
        environment.serverConfig?.environment.capabilities.worktreesDirectory !== true,
    )
  )
    return null;
  const scopeKey = targets.map((target) => target.environmentId).join(",");

  return (
    <SettingsRow
      {...searchableSetting("storage-worktrees-location")}
      description={t("storage.worktreesDirectory.description")}
      serverScoped
      settingKeys={["worktreesDirectory"]}
      resetAction={
        mixed || settings.worktreesDirectory !== "" ? (
          <SettingResetButton
            label={t("storage.worktreesDirectory.resetLabel")}
            onClick={() => updateSettings({ worktreesDirectory: "" })}
          />
        ) : null
      }
      control={
        <Input
          key={`${scopeKey}:${mixed}:${settings.worktreesDirectory}`}
          aria-label={t("storage.worktreesDirectory.inputAriaLabel")}
          autoCapitalize="none"
          spellCheck={false}
          placeholder={mixed ? t("storage.common.mixed") : t("storage.common.default")}
          defaultValue={mixed ? "" : settings.worktreesDirectory}
          onChange={() => {
            edited.current = true;
          }}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (edited.current && (mixed || value !== settings.worktreesDirectory))
              updateSettings({ worktreesDirectory: value });
            edited.current = false;
          }}
        />
      }
    />
  );
}

function RetentionControl({
  label,
  value,
  onChange,
  minimum = 1,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  minimum?: number;
}) {
  const [draft, setDraft] = useState(value);
  const [savedValue, setSavedValue] = useState(value);
  const { t } = useTranslation();
  if (savedValue !== value) {
    setSavedValue(value);
    setDraft(value);
  }

  return (
    <div className="flex items-center gap-3">
      {value !== null ? (
        <NumberField
          value={draft}
          min={minimum}
          max={3650}
          step={1}
          size="sm"
          className="w-auto"
          onValueChange={setDraft}
          onValueCommitted={(next) => {
            if (next === null) setDraft(value);
            else {
              const days = Math.min(3650, Math.max(minimum, Math.round(next)));
              setDraft(days);
              onChange(days);
            }
          }}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement
              aria-label={t("storage.retention.decreaseAriaLabel", { label })}
            />
            <NumberFieldInput
              aria-label={t("storage.retention.inDaysAriaLabel", { label })}
              size={new Intl.NumberFormat().format(draft ?? value).length}
              className="field-sizing-content w-auto min-w-[1ch] grow-0 text-right"
            />
            <span aria-hidden="true" className="self-center pr-2 text-xs">
              {t("storage.retention.daysUnit")}
            </span>
            <NumberFieldIncrement
              aria-label={t("storage.retention.increaseAriaLabel", { label })}
            />
          </NumberFieldGroup>
        </NumberField>
      ) : (
        <span className="text-xs text-muted-foreground">{t("storage.common.off")}</span>
      )}
      <Switch
        aria-label={label}
        checked={value !== null}
        onCheckedChange={(enabled) => onChange(enabled ? 8 : null)}
      />
    </div>
  );
}

const KEEP_WHEN_LABEL_KEYS = {
  "any-local-files": "storage.keepWhen.anyLocalFiles",
  "uncommitted-changes": "storage.keepWhen.uncommittedChanges",
  "tracked-changes": "storage.keepWhen.editedTrackedFiles",
} as const;

function lastRunSummary(
  entries: readonly { readonly label: string; readonly counts: string }[],
  machineCount: number,
) {
  const first = entries[0];
  if (!first) return "";
  if (machineCount <= 1) return first.counts;
  if (entries.length === machineCount && entries.every((entry) => entry.counts === first.counts)) {
    return i18next.t("storage.cleanup.onEveryMachine", {
      defaultValue: "{{counts}} on every machine",
      counts: first.counts,
    });
  }
  return entries.map((entry) => `${entry.label}: ${entry.counts}`).join(" · ");
}

function CleanupResults({
  report,
  environmentLabel,
}: {
  report: StorageCleanupReport;
  environmentLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      {report.entries.map((entry, index) => {
        const name =
          entry.kind === "worktree"
            ? ((entry.threadId === null
                ? entry.path
                : entry.path?.split(/[\\/]/).findLast(Boolean)) ??
              t("storage.cleanup.worktreesFallbackName"))
            : entry.kind === "logs"
              ? t("storage.cleanup.rotatedLogs")
              : t("storage.cleanup.browserArtifacts");
        return (
          <SettingsRow
            key={`${entry.path ?? entry.kind}:${entry.threadId ?? index}`}
            title={<span className="wrap-anywhere select-text">{name}</span>}
            description={
              <span className="block space-y-2 wrap-anywhere select-text">
                <span className={`block ${entry.outcome === "failed" ? "text-destructive" : ""}`}>
                  {entry.reason}
                </span>
                <span className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-l border-border/60 pl-3">
                  <span>{t("storage.cleanup.machine")}</span>
                  <span className="text-foreground/80">{environmentLabel}</span>
                  {entry.projectPath && (
                    <>
                      <span>{t("storage.cleanup.project")}</span>
                      <code className="text-foreground/80">{entry.projectPath}</code>
                    </>
                  )}
                  {entry.path && (
                    <>
                      <span>{t("storage.cleanup.folder")}</span>
                      <code className="text-foreground/80">{entry.path}</code>
                    </>
                  )}
                  {entry.threadTitle && (
                    <>
                      <span>{t("storage.cleanup.thread")}</span>
                      <span>{entry.threadTitle}</span>
                    </>
                  )}
                </span>
              </span>
            }
            control={
              (entry.outcome === "removed" ||
                (entry.outcome === "kept" && entry.bytes !== null)) && (
                <span className="text-xs text-muted-foreground">
                  {[
                    entry.kind !== "worktree" && entry.files !== null
                      ? t("storage.cleanup.filesCount", {
                          count: entry.files,
                          formattedCount: entry.files.toLocaleString(),
                        })
                      : null,
                    entry.bytes !== null ? formatBytes(entry.bytes) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )
            }
          />
        );
      })}
      {report.omittedCount > 0 && (
        <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
          {t("storage.cleanup.moreResults", {
            environment: environmentLabel,
            omitted: report.omittedCount.toLocaleString(),
          })}
        </p>
      )}
      {report.entries.length === 0 && report.omittedCount === 0 && (
        <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
          {t("storage.cleanup.nothingNeededCleanup", { environment: environmentLabel })}
        </p>
      )}
    </>
  );
}

const storageCleanupReportsAtom = environmentAtomList(
  "web-storage-cleanup-reports",
  (environmentId) => serverEnvironment.storageCleanupReport({ environmentId, input: {} }),
);
const storageCleanupPermissionsAtom = environmentAtomList(
  "web-storage-cleanup-permissions",
  serverEnvironment.runStorageCleanup.permissionAtom,
);

function CleanupSection() {
  const { t } = useTranslation();
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const { connectedEnvironments } = useSettingsScope();
  const [pending, setPending] = useState(false);
  const run = useAtomCommand(serverEnvironment.runStorageCleanup);
  const supported = connectedEnvironments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.storageCleanupRun === true,
  );
  const supportedIds = supported.map(({ environmentId }) => environmentId);
  const reports = useAtomValue(storageCleanupReportsAtom(environmentIdsKey(supportedIds)));
  const permissions = useAtomValue(storageCleanupPermissionsAtom(environmentIdsKey(supportedIds)));
  const state = supportedIds.map((environmentId, index) => {
    const query = reports[index]!;
    return {
      environmentId,
      allowed: permissions[index]!,
      report: query._tag === "Success" ? query.value : null,
      loading: query.waiting,
      failed: query._tag === "Failure",
    };
  });
  const hasRules = supported.some((environment) => {
    const settings = environment.serverConfig?.settings;
    if (!settings) return false;
    const enabled = (rules: WorktreeCleanupRules) =>
      rules.worktreeAfterDays !== null ||
      rules.worktreeSettledAfterDays !== null ||
      rules.worktreeOnMerge ||
      rules.worktreeOnDelete ||
      rules.worktreeUnchanged;
    return (
      settings.storageCleanup.browserArtifactsAfterDays !== null ||
      settings.storageCleanup.logsAfterDays !== null ||
      enabled(resolveWorktreeCleanup(settings, null)) ||
      Object.values(settings.projectSettingsOverrides).some(
        (override) =>
          override.worktreeCleanup?.mode === "custom" && enabled(override.worktreeCleanup.rules),
      )
    );
  });
  if (supported.length === 0) return null;
  const summaries = supported.map((environment) => {
    const query = state.find((entry) => entry.environmentId === environment.environmentId);
    const report = query?.report ?? null;
    return {
      environment,
      report,
      label: settingsScopeEnvironmentLabel(environment, connectedEnvironments),
      counts: report
        ? t("storage.cleanup.counts", {
            removed: report.counts.removed,
            kept: report.counts.kept,
          }) +
          (report.counts.failed > 0
            ? t("storage.cleanup.countsFailed", { failed: report.counts.failed })
            : "")
        : "",
      description: report
        ? t("storage.cleanup.lastRunSummary", {
            time: formatRelativeTimeLabel(report.finishedAt, nowMs),
            recovered: formatBytes(report.bytesFreed),
          }) +
          (report.counts.failed > 0
            ? ` ${t("storage.cleanup.failedItems", { count: report.counts.failed })}`
            : "")
        : query?.failed
          ? t("storage.cleanup.couldNotLoadLastRun")
          : query?.loading
            ? t("storage.cleanup.loadingLastRun")
            : t("storage.cleanup.notRunYet"),
    };
  });
  const deleteNow = async () => {
    if (pending) return;
    setPending(true);
    await Promise.all(
      supported
        .filter((environment) =>
          state.some((entry) => entry.environmentId === environment.environmentId && entry.allowed),
        )
        .map(async (environment) => {
          const result = await run({ environmentId: environment.environmentId, input: {} });
          if (result._tag === "Success") {
            const failures = result.value.entries.filter((entry) => entry.outcome === "failed");
            if (failures.length > 0)
              toastManager.add({
                type: "error",
                title: t("storage.cleanup.failedOn", { environment: environment.label }),
                description: failures[0]!.reason,
              });
          } else if (!isAtomCommandInterrupted(result)) {
            toastManager.add({
              type: "error",
              title: t("storage.cleanup.couldNotRunOn", { environment: environment.label }),
              description: String(squashAtomCommandFailure(result)),
            });
          }
        }),
    ).finally(() => setPending(false));
  };
  return (
    <SettingsSection id="storage-cleanup" title={t("storage.sections.cleanup")} variant="plain">
      <SettingsGroup>
        <SettingsRow
          {...searchableSetting("storage-delete-now")}
          description={
            <span>
              {!hasRules
                ? t("storage.cleanup.turnOnRuleHint")
                : summaries.map(({ environment, label, description }) => (
                    <span key={environment.environmentId} className="block">
                      {supported.length > 1 ? `${label}: ` : ""}
                      {description}
                    </span>
                  ))}
            </span>
          }
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={pending || !hasRules || !state.some((entry) => entry.allowed)}
              onClick={() => void deleteNow()}
            >
              {pending ? t("storage.cleanup.deleting") : t("storage.cleanup.deleteNow")}
            </Button>
          }
        />
      </SettingsGroup>
      {summaries.some(({ report }) => report !== null) && (
        <FoldedSettingsSection
          id="storage-cleanup-last-run"
          title={t("storage.cleanup.lastRun")}
          headerPlacement="inside"
          summary={lastRunSummary(
            summaries.filter(({ report }) => report !== null),
            connectedEnvironments.length,
          )}
        >
          {summaries.map(
            ({ environment, label, report }) =>
              report && (
                <CleanupResults
                  key={environment.environmentId}
                  report={report}
                  environmentLabel={label}
                />
              ),
          )}
        </FoldedSettingsSection>
      )}
    </SettingsSection>
  );
}

export function StorageSettingsPanel() {
  const { t } = useTranslation();
  const { scope, environments, connectedEnvironments, targets, target } = useSettingsScope();
  const scopedSettings = useScopedSettings();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const settings = {
    ...scopedSettings.storageCleanup,
    ...resolveWorktreeCleanup(scopedSettings, null),
  };
  const projectMode = (entry: ScopedSettingsTarget | null) =>
    entry?.sources.worktreeCleanup === "project"
      ? (entry.settings.worktreeCleanup?.mode ?? "inherit")
      : "inherit";
  const mode = projectMode(target);
  const mixedModes = targets.some((entry) => projectMode(entry) !== mode);
  const updateSettings = useUpdateScopedSettings();
  const clearSettings = useClearScopedSettings();
  const ruleStatus = (key: keyof StorageCleanupSettings) =>
    targets.some(
      (target) =>
        ({ ...target.settings.storageCleanup, ...resolveWorktreeCleanup(target.settings, null) })[
          key
        ] !== settings[key],
    )
      ? t("storage.modeStatus.mixedAcrossMachines")
      : undefined;
  const update = (patch: Partial<StorageCleanupSettings>) =>
    updateSettings({ storageCleanup: patch });
  const updateWorktree = (patch: Partial<WorktreeCleanupRules>) =>
    isProjectScope
      ? updateSettings({ worktreeCleanup: { mode: "custom", rules: patch } })
      : update(patch);

  if (
    isProjectScope &&
    connectedEnvironments.some(
      (environment) =>
        environment.serverConfig?.environment.capabilities.projectWorktreeCleanup !== true,
    )
  ) {
    return (
      <SettingsScopeNotice target="all">
        {t("storage.scopeNotice.updateMachinesForProjectCleanup")}
      </SettingsScopeNotice>
    );
  }

  if (
    connectedEnvironments.some(
      (environment) => environment.serverConfig?.environment.capabilities.storageCleanup !== true,
    )
  ) {
    return (
      <SettingsScopeNotice
        target="environment"
        eligibleEnvironmentIds={connectedEnvironments
          .filter(
            (environment) =>
              environment.serverConfig?.environment.capabilities.storageCleanup === true,
          )
          .map((environment) => environment.environmentId)}
      >
        {t("storage.scopeNotice.updateEnvironmentsForCleanup")}
      </SettingsScopeNotice>
    );
  }

  return (
    <SettingsPageContainer>
      {!isProjectScope && (
        <DatabaseStorageNotice
          environments={connectedEnvironments.filter(
            (environment) =>
              environment.serverConfig?.environment.capabilities.databaseStorage === true,
          )}
        />
      )}
      <SettingsSection id="storage-worktrees" title={t("storage.sections.worktrees")}>
        {!isProjectScope && <WorktreesDirectoryRow />}
        {isProjectScope && (
          <SettingsRow
            title={t("storage.worktreeCleanupMode.title")}
            description={
              mode === "off"
                ? t("storage.worktreeCleanupMode.descriptionOff")
                : mode === "custom"
                  ? t("storage.worktreeCleanupMode.descriptionCustom")
                  : t("storage.worktreeCleanupMode.descriptionInherit")
            }
            serverScoped
            settingKeys={["worktreeCleanup"]}
            mixed={mixedModes}
            control={
              <Select
                value={mixedModes ? null : mode}
                onValueChange={(next) => {
                  if (next === "inherit") clearSettings(["worktreeCleanup"]);
                  else if (next === "off") updateSettings({ worktreeCleanup: { mode: "off" } });
                  else if (next === "custom")
                    updateSettings({ worktreeCleanup: { mode: "custom", rules: {} } });
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={t("storage.worktreeCleanupMode.selectAriaLabel")}
                >
                  <SelectValue>
                    {mixedModes
                      ? t("storage.common.mixed")
                      : mode === "inherit"
                        ? t("storage.common.inherit")
                        : mode === "off"
                          ? t("storage.common.off")
                          : t("storage.common.custom")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="inherit">{t("storage.common.inherit")}</SelectItem>
                  <SelectItem value="off">{t("storage.common.off")}</SelectItem>
                  <SelectItem value="custom">{t("storage.common.custom")}</SelectItem>
                </SelectPopup>
              </Select>
            }
          />
        )}
        {(!isProjectScope || (!mixedModes && mode === "custom")) && (
          <>
            <SettingsRow
              title={t("storage.rules.deleteWithDeletedThreads")}
              status={ruleStatus("worktreeOnDelete")}
              description={t("storage.rules.deleteWithDeletedThreadsDescription")}
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label={t("storage.rules.deleteWithDeletedThreads")}
                  checked={settings.worktreeOnDelete}
                  onCheckedChange={(worktreeOnDelete) => updateWorktree({ worktreeOnDelete })}
                />
              }
            />
            <SettingsRow
              title={t("storage.rules.deleteInactive")}
              status={ruleStatus("worktreeAfterDays")}
              description={t("storage.rules.deleteInactiveDescription")}
              serverScoped={!isProjectScope}
              control={
                <RetentionControl
                  label={t("storage.rules.deleteInactive")}
                  value={settings.worktreeAfterDays}
                  onChange={(worktreeAfterDays) => updateWorktree({ worktreeAfterDays })}
                />
              }
            />
            {connectedEnvironments.length > 0 &&
              connectedEnvironments.every(
                (environment) =>
                  environment.serverConfig?.environment.capabilities.settledWorktreeCleanup ===
                  true,
              ) && (
                <SettingsRow
                  title={t("storage.rules.deleteSettled")}
                  status={[
                    ruleStatus("worktreeSettledAfterDays"),
                    environments.length > connectedEnvironments.length
                      ? t("storage.modeStatus.offlineMachines")
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(". ")}
                  description={t("storage.rules.deleteSettledDescription")}
                  serverScoped={!isProjectScope}
                  control={
                    <RetentionControl
                      label={t("storage.rules.deleteSettled")}
                      value={settings.worktreeSettledAfterDays}
                      minimum={0}
                      onChange={(worktreeSettledAfterDays) =>
                        updateWorktree({ worktreeSettledAfterDays })
                      }
                    />
                  }
                />
              )}
            <SettingsRow
              title={t("storage.rules.deleteMerged")}
              status={ruleStatus("worktreeOnMerge")}
              description={t("storage.rules.deleteMergedDescription")}
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label={t("storage.rules.deleteMerged")}
                  checked={settings.worktreeOnMerge}
                  onCheckedChange={(worktreeOnMerge) => updateWorktree({ worktreeOnMerge })}
                />
              }
            />
            <SettingsRow
              title={t("storage.rules.deleteUnchanged")}
              status={ruleStatus("worktreeUnchanged")}
              description={t("storage.rules.deleteUnchangedDescription")}
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label={t("storage.rules.deleteUnchanged")}
                  checked={settings.worktreeUnchanged}
                  onCheckedChange={(worktreeUnchanged) => updateWorktree({ worktreeUnchanged })}
                />
              }
            />
            {connectedEnvironments.every(
              (environment) =>
                environment.serverConfig?.environment.capabilities.storageCleanupRun === true,
            ) && (
              <SettingsRow
                {...searchableSetting("storage-worktree-keep-when")}
                status={ruleStatus("worktreeKeepWhen")}
                description={
                  settings.worktreeKeepWhen === "any-local-files"
                    ? t("storage.rules.keepWhenAnyLocalFilesDescription")
                    : settings.worktreeKeepWhen === "tracked-changes"
                      ? t("storage.rules.keepWhenTrackedChangesDescription")
                      : t("storage.rules.keepWhenUncommittedChangesDescription")
                }
                serverScoped={!isProjectScope}
                control={
                  <Select
                    value={ruleStatus("worktreeKeepWhen") ? null : settings.worktreeKeepWhen}
                    onValueChange={(next) => {
                      if (
                        next === "any-local-files" ||
                        next === "uncommitted-changes" ||
                        next === "tracked-changes"
                      )
                        updateWorktree({ worktreeKeepWhen: next });
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      aria-label={t("storage.rules.keepWhenSelectAriaLabel")}
                    >
                      <SelectValue>
                        {ruleStatus("worktreeKeepWhen")
                          ? t("storage.common.mixed")
                          : t(KEEP_WHEN_LABEL_KEYS[settings.worktreeKeepWhen])}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      <SelectItem value="any-local-files">
                        {t("storage.keepWhen.anyLocalFiles")}
                      </SelectItem>
                      <SelectItem value="uncommitted-changes">
                        {t("storage.keepWhen.uncommittedChanges")}
                      </SelectItem>
                      <SelectItem value="tracked-changes">
                        {t("storage.keepWhen.editedTrackedFiles")}
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                }
              />
            )}
          </>
        )}
      </SettingsSection>

      {!isProjectScope && (
        <SettingsSection id="storage-artifacts" title={t("storage.sections.artifactsAndLogs")}>
          <SettingsRow
            title={t("storage.artifacts.deleteOldBrowserArtifacts")}
            status={ruleStatus("browserArtifactsAfterDays")}
            description={t("storage.artifacts.deleteOldBrowserArtifactsDescription")}
            serverScoped
            control={
              <RetentionControl
                label={t("storage.artifacts.deleteOldBrowserArtifacts")}
                value={settings.browserArtifactsAfterDays}
                onChange={(browserArtifactsAfterDays) => update({ browserArtifactsAfterDays })}
              />
            }
          />
          <SettingsRow
            title={t("storage.artifacts.deleteOldRotatedLogs")}
            status={ruleStatus("logsAfterDays")}
            description={t("storage.artifacts.deleteOldRotatedLogsDescription")}
            serverScoped
            control={
              <RetentionControl
                label={t("storage.artifacts.deleteOldRotatedLogs")}
                value={settings.logsAfterDays}
                onChange={(logsAfterDays) => update({ logsAfterDays })}
              />
            }
          />
        </SettingsSection>
      )}
      {!isProjectScope && <CleanupSection />}
    </SettingsPageContainer>
  );
}
