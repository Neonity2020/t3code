import { SettingsGroup } from "./SettingsGroup";
import { NotificationSettings } from "./NotificationSettings";
import { PRIVACY_POLICY_URL } from "../../legalLinks";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  type DesktopUpdateChannel,
  IDLE_COMPACTION_MODES,
  globalIdleCompaction,
  isUiLanguage,
  ProviderDriverKind,
  type ProviderInstanceId,
  type SidebarProjectGroupingMode,
} from "@t3tools/contracts";
import {
  DEFAULT_UNIFIED_SETTINGS,
  type DiffLayout,
  MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  type ResponseStreamingMode,
  type QuitConfirmationMode,
  SidebarProjectSortOrder,
} from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import { APP_VERSION, HOSTED_APP_CHANNEL, HOSTED_APP_CHANNEL_LABEL } from "../../branding";
import { CliCommandSettingsRow } from "./CliCommandSettingsRow";
import { MobileAppSettingsRow } from "./MobileAppSettingsRow";
import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateDisabledReason,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "../../components/desktopUpdate.logic";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { isElectron } from "../../env";
import { buildHostedChannelSelectionUrl, type HostedAppChannel } from "../../hostedPairing";
import {
  readAppearanceModePreference,
  readThemeHalves,
  readThemePreference,
  useTheme,
} from "../../hooks/useTheme";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useSettingsScope } from "./SettingsScopeContext";
import { scopedIdleCompaction } from "./scopedSettings";
import { ProjectDefaultsSettings } from "./ProjectDefaultsSettings";
import { ThreadTitleInstructionsSettings } from "./ThreadTitleInstructionsSettings";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
  selectsPlanAgent,
} from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import { isMacPlatform } from "../../lib/utils";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { DraftInput } from "../ui/draft-input";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { ScopedSwitch } from "./ScopedSwitch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  getChangedBrowserSettingLabels,
  getChangedTypographySettingLabels,
  hasChangedBackgroundActivitySettings,
  isProjectGroupingEnabled,
  projectGroupingModeFromToggle,
  readLastEnabledProjectGroupingMode,
  rememberEnabledProjectGroupingMode,
} from "./SettingsPanels.logic";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useSettingsSearchTarget,
  useSettingsSearchTargetId,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { BackgroundActivitySettingsRow } from "./BackgroundActivitySettings";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  UI_LANGUAGE_NATIVE_LABELS,
  uiLanguageOptions,
  useUiLanguage,
} from "../../i18n/useUiLanguage";

const responseStreamingModeLabels = (t: TFunction): Record<ResponseStreamingMode, string> => ({
  turn: t("settings.options.responseStreaming.turn"),
  paragraph: t("settings.options.responseStreaming.paragraph"),
});

const responseStreamingModeDescriptions = (
  t: TFunction,
): Record<ResponseStreamingMode, string> => ({
  turn: t("settings.options.responseStreaming.turnDescription"),
  paragraph: t("settings.options.responseStreaming.paragraphDescription"),
});

const sidebarProjectSortOrderLabels = (t: TFunction): Record<SidebarProjectSortOrder, string> => ({
  updated_at: t("settings.options.sortOrder.lastUserMessage"),
  created_at: t("settings.options.sortOrder.createdAt"),
  manual: t("settings.options.sortOrder.manual"),
});
const isSidebarProjectSortOrder = Schema.is(SidebarProjectSortOrder);

const timestampFormatLabels = (t: TFunction) => ({
  locale: t("settings.options.timestamp.systemDefault"),
  "12-hour": t("settings.options.timestamp.12hour"),
  "24-hour": t("settings.options.timestamp.24hour"),
});

const diffLayoutLabels = (t: TFunction): Record<DiffLayout, string> => ({
  stacked: t("settings.options.diffLayout.stacked"),
  split: t("settings.options.diffLayout.split"),
});

const quitConfirmationModeLabels = (t: TFunction): Record<QuitConfirmationMode, string> => ({
  direct: t("settings.options.quitMode.direct"),
  hold: t("settings.options.quitMode.hold"),
  "double-click": t("settings.options.quitMode.doublePress"),
});

const mixedLabel = (t: TFunction) => t("settings.options.mixed");

const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");
function AboutVersionTitle() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-baseline gap-2">
      <span>{t("settings.about.version")}</span>
      <code className="text-2xs font-medium text-muted-foreground">{APP_VERSION}</code>
    </span>
  );
}

function AboutVersionSection() {
  const { t } = useTranslation();
  const updateState = useDesktopUpdateState();
  const [isChangingUpdateChannel, setIsChangingUpdateChannel] = useState(false);
  const [isUpdateActionPending, setIsUpdateActionPending] = useState(false);

  const hasDesktopBridge = typeof window !== "undefined" && Boolean(window.desktopBridge);
  const selectedUpdateChannel = updateState?.channel ?? "latest";
  const selectedHostedAppChannel = hasDesktopBridge ? null : HOSTED_APP_CHANNEL;

  const handleUpdateChannelChange = (channel: DesktopUpdateChannel) => {
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.setUpdateChannel !== "function" ||
      channel === selectedUpdateChannel
    ) {
      return;
    }

    setIsChangingUpdateChannel(true);
    void bridge
      .setUpdateChannel(channel)
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: t("settings.update.couldNotChangeTrack"),
            description:
              error instanceof Error ? error.message : t("settings.update.trackChangeFailed"),
          }),
        );
      })
      .finally(() => {
        setIsChangingUpdateChannel(false);
      });
  };

  const handleButtonClick = async () => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";

    if (action === "download") {
      void bridge.downloadUpdate().catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: t("settings.update.couldNotDownload"),
            description:
              error instanceof Error ? error.message : t("settings.update.downloadFailed"),
          }),
        );
      });
      return;
    }

    if (action === "install") {
      if (isUpdateActionPending) return;
      setIsUpdateActionPending(true);
      let confirmed = false;
      try {
        confirmed = await ensureLocalApi().dialogs.confirm(
          getDesktopUpdateInstallConfirmationMessage(
            updateState ?? { availableVersion: null, downloadedVersion: null },
          ),
        );
      } catch (error) {
        setIsUpdateActionPending(false);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: t("settings.update.couldNotConfirm"),
            description:
              error instanceof Error ? error.message : t("settings.update.confirmFailed"),
          }),
        );
        return;
      }
      if (!confirmed) {
        setIsUpdateActionPending(false);
        return;
      }
      void bridge
        .installUpdate()
        .catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: t("settings.update.couldNotInstall"),
              description:
                error instanceof Error ? error.message : t("settings.update.installFailed"),
            }),
          );
        })
        .finally(() => setIsUpdateActionPending(false));
      return;
    }

    if (typeof bridge.checkForUpdate !== "function") return;
    void bridge
      .checkForUpdate()
      .then((result) => {
        if (!result.checked) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: t("settings.update.couldNotCheck"),
              description: result.state.message ?? t("settings.update.autoUnavailable"),
            }),
          );
        }
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: t("settings.update.couldNotCheck"),
            description: error instanceof Error ? error.message : t("settings.update.checkFailed"),
          }),
        );
      });
  };

  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  const buttonTooltip = updateState ? getDesktopUpdateButtonTooltip(updateState) : null;
  const buttonDisabled =
    action === "none"
      ? !canCheckForUpdate(updateState)
      : isDesktopUpdateButtonDisabled(updateState);

  const actionLabel: Record<string, string> = {
    download: t("settings.update.download"),
    install: t("settings.update.install"),
  };
  const statusLabel: Record<string, string> = {
    checking: t("settings.update.checking"),
    downloading: t("settings.update.downloading"),
    "up-to-date": t("settings.update.upToDate"),
  };
  const buttonLabel =
    actionLabel[action] ??
    statusLabel[updateState?.status ?? ""] ??
    t("settings.update.checkForUpdates");
  const description =
    action === "download" || action === "install"
      ? t("settings.update.updateAvailable")
      : (getDesktopUpdateDisabledReason(updateState) ?? t("settings.update.currentVersion"));

  return (
    <>
      <SettingsRow
        id={searchableSetting("app-version").id}
        title={<AboutVersionTitle />}
        description={description}
        control={
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={buttonDisabled || isUpdateActionPending}
                  onClick={handleButtonClick}
                >
                  {buttonLabel}
                </Button>
              }
            />
            {buttonTooltip ? <TooltipPopup>{buttonTooltip}</TooltipPopup> : null}
          </Tooltip>
        }
      />
      {hasDesktopBridge ? (
        <SettingsRow
          {...searchableSetting("update-track")}
          description={t("settings.update.trackDescription")}
          control={
            <Select
              value={selectedUpdateChannel}
              onValueChange={(value) => {
                handleUpdateChannelChange(value as DesktopUpdateChannel);
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("settings.rows.update-track.title")}
                disabled={isChangingUpdateChannel}
              >
                <SelectValue>
                  {selectedUpdateChannel === "nightly"
                    ? t("settings.update.nightly")
                    : t("settings.update.stable")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  {t("settings.update.stable")}
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  {t("settings.update.nightly")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : selectedHostedAppChannel ? (
        <SettingsRow
          {...searchableSetting("update-track")}
          description={t("settings.update.hostedTrackDescription")}
          control={
            <Select
              value={selectedHostedAppChannel}
              onValueChange={(value) => {
                if (value === selectedHostedAppChannel) return;
                window.location.assign(
                  buildHostedChannelSelectionUrl({ channel: value as HostedAppChannel }),
                );
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("settings.rows.update-track.title")}
              >
                <SelectValue>{HOSTED_APP_CHANNEL_LABEL}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  {t("settings.update.latest")}
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  {t("settings.update.nightly")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : null}
      {hasDesktopBridge ? <CliCommandSettingsRow /> : null}
    </>
  );
}

export function useSettingsRestore(onRestored?: () => void) {
  const { t } = useTranslation();
  const {
    theme,
    setTheme,
    followSystem,
    setFollowSystem,
    setThemeHalf,
    clearThemeHalves,
    themeHalves,
  } = useTheme();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const isBackgroundActivityDirty = hasChangedBackgroundActivitySettings(settings);

  const changedSettingLabels = [
    ...(theme !== "system" ? [t("settings.changed.theme")] : []),
    ...(!followSystem ? [t("settings.changed.followSystem")] : []),
    ...(themeHalves !== null ? [t("settings.changed.themeMix")] : []),
    ...(settings.appearanceContrast !== DEFAULT_UNIFIED_SETTINGS.appearanceContrast
      ? [t("settings.changed.contrast")]
      : []),
    ...(settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity
      ? [t("settings.changed.glassOpacity")]
      : []),
    ...(settings.diffColorScheme !== DEFAULT_UNIFIED_SETTINGS.diffColorScheme
      ? [t("settings.changed.diffColors")]
      : []),
    ...(settings.chatWidth !== DEFAULT_UNIFIED_SETTINGS.chatWidth
      ? [t("settings.changed.chatWidth")]
      : []),
    ...(settings.mathRenderingEnabled !== DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled
      ? [t("settings.changed.renderMath")]
      : []),
    ...(settings.redesignEnabled !== DEFAULT_UNIFIED_SETTINGS.redesignEnabled
      ? [t("settings.changed.newDesign")]
      : []),
    ...(settings.panelAnimationDurationMs !== DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs
      ? [t("settings.changed.panelAnimations")]
      : []),
    ...(settings.environmentIdentificationMode !==
    DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode
      ? [t("settings.changed.environmentIdentification")]
      : []),
    ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
      ? [t("settings.changed.timeFormat")]
      : []),
    ...(settings.notificationMode !== DEFAULT_UNIFIED_SETTINGS.notificationMode
      ? [t("settings.changed.threadNotifications")]
      : []),
    ...(settings.inAppNotificationsEnabled !== DEFAULT_UNIFIED_SETTINGS.inAppNotificationsEnabled
      ? [t("settings.changed.inAppNotifications")]
      : []),
    ...(settings.sidebarThreadPreviewCount !== DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount
      ? [t("settings.changed.visibleThreads")]
      : []),
    ...(settings.sidebarProjectGroupingMode !== DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode
      ? [t("settings.changed.projectGrouping")]
      : []),
    ...(settings.sidebarProjectSortOrder !== DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder
      ? [t("settings.changed.projectOrder")]
      : []),
    ...(settings.sidebarWorkingShelfEnabled !== DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled
      ? [t("settings.changed.workingSection")]
      : []),
    ...(settings.sidebarAutoSettleAfterDays !== DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays
      ? [t("settings.changed.autoSettleInactiveThreads")]
      : []),
    ...(settings.sidebarAutoSettleKeepPullRequests !==
    DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleKeepPullRequests
      ? [t("settings.changed.keepThreadsWithPr")]
      : []),
    ...(settings.sidebarAutoSettleOnMerge !== DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge
      ? [t("settings.changed.autoSettleMergedThreads")]
      : []),
    ...(settings.autoResumeLimitedThreads !== DEFAULT_UNIFIED_SETTINGS.autoResumeLimitedThreads
      ? [t("settings.changed.resumeAfterUsageLimits")]
      : []),
    ...(settings.snoozeLimitedThreads !== DEFAULT_UNIFIED_SETTINGS.snoozeLimitedThreads
      ? [t("settings.changed.snoozeUntilLimitsReset")]
      : []),
    ...(settings.wordWrap !== DEFAULT_UNIFIED_SETTINGS.wordWrap
      ? [t("settings.changed.wordWrap")]
      : []),
    ...(settings.persistComposerContextStrip !==
    DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip
      ? [t("settings.changed.composerContext")]
      : []),
    ...getChangedTypographySettingLabels(settings),
    ...(settings.diffFilesCollapsed !== DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed
      ? [t("settings.changed.defaultDiffFileState")]
      : []),
    ...(settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace
      ? [t("settings.changed.diffWhitespaceChanges")]
      : []),
    ...(settings.diffLayout !== DEFAULT_UNIFIED_SETTINGS.diffLayout
      ? [t("settings.changed.diffLayout")]
      : []),
    ...(settings.proactivePanelsEnabled !== DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled
      ? [t("settings.changed.proactivePanels")]
      : []),
    ...(settings.showSkillsInSlashMenu !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu
      ? [t("settings.changed.showSkillsInSlashMenu")]
      : []),
    ...(settings.composerCollapseOnScroll !== DEFAULT_UNIFIED_SETTINGS.composerCollapseOnScroll
      ? [t("settings.changed.collapseComposerOnScroll")]
      : []),
    ...(settings.composerRichTextEnabled !== DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled
      ? [t("settings.changed.richTextComposer")]
      : []),
    ...(settings.sendShortcut !== DEFAULT_UNIFIED_SETTINGS.sendShortcut
      ? [t("settings.changed.sendShortcut")]
      : []),
    ...(settings.followUpBehavior !== DEFAULT_UNIFIED_SETTINGS.followUpBehavior
      ? [t("settings.changed.followUpBehavior")]
      : []),
    ...(settings.contextWindowMeterEnabled !== DEFAULT_UNIFIED_SETTINGS.contextWindowMeterEnabled
      ? [t("settings.changed.contextWindowIndicator")]
      : []),
    ...(settings.responseStreamingMode !== DEFAULT_UNIFIED_SETTINGS.responseStreamingMode
      ? [t("settings.changed.responseStreaming")]
      : []),
    ...(settings.enableProviderUpdateChecks !== DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks
      ? [t("settings.changed.providerUpdateChecks")]
      : []),
    ...(settings.continueThreadsAfterServerUpdate !==
    DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate
      ? [t("settings.changed.continueThreadsAfterRestarts")]
      : []),
    ...(isBackgroundActivityDirty ? [t("settings.changed.backgroundActivity")] : []),
    ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
      ? [t("settings.changed.newThreadMode")]
      : []),
    ...(settings.newWorktreesStartFromOrigin !==
    DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin
      ? [t("settings.changed.newWorktreesStartFromRemote")]
      : []),
    ...(settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
      ? [t("settings.changed.addProjectBaseDirectory")]
      : []),
    ...(settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin
      ? [t("settings.changed.unpinConfirmation")]
      : []),
    ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
      ? [t("settings.changed.archiveConfirmation")]
      : []),
    ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
      ? [t("settings.changed.deleteConfirmation")]
      : []),
    ...(settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit
      ? [t("settings.changed.quitShortcut")]
      : []),
    ...(isTextGenerationModelDirty ? [t("settings.changed.textGenerationModel")] : []),
    ...(settings.threadTitleInstructions !== DEFAULT_UNIFIED_SETTINGS.threadTitleInstructions
      ? [t("settings.changed.threadTitleInstructions")]
      : []),
    ...getChangedBrowserSettingLabels(settings),
    ...(settings.enableAgentBrowserAccess !== DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess
      ? [t("settings.changed.agentBrowserAccess")]
      : []),
  ];

  const restoreDefaults = async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readLocalApi();
    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
      [
        t("settings.restore.title"),
        t("settings.restore.body", { labels: changedSettingLabels.join(", ") }),
      ].join("\n"),
      { variant: "destructive" },
    );
    if (!confirmed) return;

    // Reset only dirty theme keys so storage failures cannot block other settings; re-read after confirmation
    // for safe rollback.
    let previousTheme = theme;
    try {
      previousTheme = readThemePreference();
    } catch {}
    const liveHalves = readThemeHalves();
    const needsThemeReset = previousTheme !== "system";
    const needsMixReset = liveHalves !== null;
    const needsFollowSystemReset = readAppearanceModePreference(previousTheme) !== "system";
    const notifyThemeRestoreFailure = () => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("settings.restore.themeFailureTitle"),
          description: t("settings.restore.themeFailureDescription"),
        }),
      );
    };
    // Restore the base preference before the mix because restoring the base clears the mix.
    const previousHalves = liveHalves;
    const rollbackThemeState = () => {
      if (needsThemeReset) setTheme(previousTheme);
      if (previousHalves?.light) setThemeHalf("light", previousHalves.light);
      if (previousHalves?.dark) setThemeHalf("dark", previousHalves.dark);
    };
    if (needsThemeReset && !setTheme("system")) {
      notifyThemeRestoreFailure();
      return;
    }
    if (needsMixReset && !clearThemeHalves()) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    if (needsFollowSystemReset && !setFollowSystem(true)) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    updateSettings({
      appearanceContrast: DEFAULT_UNIFIED_SETTINGS.appearanceContrast,
      diffColorScheme: DEFAULT_UNIFIED_SETTINGS.diffColorScheme,
      chatWidth: DEFAULT_UNIFIED_SETTINGS.chatWidth,
      mathRenderingEnabled: DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled,
      redesignEnabled: DEFAULT_UNIFIED_SETTINGS.redesignEnabled,
      timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
      notificationMode: DEFAULT_UNIFIED_SETTINGS.notificationMode,
      inAppNotificationsEnabled: DEFAULT_UNIFIED_SETTINGS.inAppNotificationsEnabled,
      wordWrap: DEFAULT_UNIFIED_SETTINGS.wordWrap,
      persistComposerContextStrip: DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip,
      diffFilesCollapsed: DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed,
      diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
      diffLayout: DEFAULT_UNIFIED_SETTINGS.diffLayout,
      proactivePanelsEnabled: DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled,
      showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
      composerCollapseOnScroll: DEFAULT_UNIFIED_SETTINGS.composerCollapseOnScroll,
      composerRichTextEnabled: DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled,
      sendShortcut: DEFAULT_UNIFIED_SETTINGS.sendShortcut,
      followUpBehavior: DEFAULT_UNIFIED_SETTINGS.followUpBehavior,
      contextWindowMeterEnabled: DEFAULT_UNIFIED_SETTINGS.contextWindowMeterEnabled,
      environmentIdentificationMode: DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode,
      glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity,
      panelAnimationDurationMs: DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs,
      sidebarThreadPreviewCount: DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount,
      sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
      sidebarProjectSortOrder: DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder,
      sidebarWorkingShelfEnabled: DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled,
      sidebarAutoSettleAfterDays: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays,
      sidebarAutoSettleKeepPullRequests: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleKeepPullRequests,
      sidebarAutoSettleOnMerge: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge,
      autoResumeLimitedThreads: DEFAULT_UNIFIED_SETTINGS.autoResumeLimitedThreads,
      snoozeLimitedThreads: DEFAULT_UNIFIED_SETTINGS.snoozeLimitedThreads,
      responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
      enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
      continueThreadsAfterServerUpdate: DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate,
      backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
      backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
      automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
      providerHealthRefreshInterval: DEFAULT_UNIFIED_SETTINGS.providerHealthRefreshInterval,
      defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
      newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
      addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
      confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
      confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
      confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
      confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit,
      textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
      threadTitleInstructions: DEFAULT_UNIFIED_SETTINGS.threadTitleInstructions,
      fontFamilySans: DEFAULT_UNIFIED_SETTINGS.fontFamilySans,
      fontFamilyComposer: DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer,
      fontFamilyCode: DEFAULT_UNIFIED_SETTINGS.fontFamilyCode,
      fontFamilyTerminal: DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal,
      fontSizeInterface: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface,
      fontSizePrompt: DEFAULT_UNIFIED_SETTINGS.fontSizePrompt,
      fontSizeCode: DEFAULT_UNIFIED_SETTINGS.fontSizeCode,
      fontSizeTerminal: DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal,
      browserDefaultViewport: DEFAULT_UNIFIED_SETTINGS.browserDefaultViewport,
      browserDefaultZoomFactor: DEFAULT_UNIFIED_SETTINGS.browserDefaultZoomFactor,
      browserDefaultAppearance: DEFAULT_UNIFIED_SETTINGS.browserDefaultAppearance,
      browserRecordingFrameRate: DEFAULT_UNIFIED_SETTINGS.browserRecordingFrameRate,
      browserRecordingShowKeyPresses: DEFAULT_UNIFIED_SETTINGS.browserRecordingShowKeyPresses,
      browserRecordingShowMousePresses: DEFAULT_UNIFIED_SETTINGS.browserRecordingShowMousePresses,
      browserLinkTarget: DEFAULT_UNIFIED_SETTINGS.browserLinkTarget,
      browserSearchEngine: DEFAULT_UNIFIED_SETTINGS.browserSearchEngine,
      browserCustomSearchUrl: DEFAULT_UNIFIED_SETTINGS.browserCustomSearchUrl,
      browserAutoShowFloatingPreview: DEFAULT_UNIFIED_SETTINGS.browserAutoShowFloatingPreview,
      pullRequestLinksOpenInApp: DEFAULT_UNIFIED_SETTINGS.pullRequestLinksOpenInApp,
      enableAgentBrowserAccess: DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess,
    });
    onRestored?.();
  };

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

const AUTO_SETTLE_DEFAULT_DAYS = DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays ?? 3;

function AutoSettleDaysInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (days: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [draftSource, setDraftSource] = useState(value);
  if (draftSource !== value) {
    setDraftSource(value);
    setDraft(String(value));
  }

  return (
    <Input
      size="sm"
      type="number"
      min={MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS}
      max={MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS}
      className="w-full sm:w-24"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        const parsed = Number(event.target.value);
        if (
          Number.isInteger(parsed) &&
          parsed >= MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS &&
          parsed <= MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS
        ) {
          onCommit(parsed);
        }
      }}
      onBlur={() => setDraft(String(value))}
      aria-label="Days of inactivity before auto-settle"
    />
  );
}

const LEGACY_FEATURE_TARGET_IDS: ReadonlySet<string> = new Set([
  "legacy-plan-mode",
  "legacy-context-window-indicator",
  "legacy-sidebar",
]);

function LegacyFeaturesSection() {
  const { t } = useTranslation();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const [open, setOpen] = useState(false);
  const searchTargetId = useSettingsSearchTargetId();
  const targetRef = useSettingsSearchTarget<HTMLElement>("legacy-features");
  // A search jump to a legacy setting opens the fold before its row mounts.
  const [seenSearchTargetId, setSeenSearchTargetId] = useState<string | null>(null);
  if (seenSearchTargetId !== searchTargetId) {
    setSeenSearchTargetId(searchTargetId);
    if (searchTargetId !== null && LEGACY_FEATURE_TARGET_IDS.has(searchTargetId)) setOpen(true);
  }

  return (
    <section id="legacy-features" ref={targetRef} tabIndex={-1} className="space-y-2.5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group flex min-h-8 w-full items-center gap-2 px-3 sm:px-4">
          <h2 className="text-sm font-normal text-foreground/70 transition-colors group-hover:text-foreground">
            {t("settings.legacy.title")}
          </h2>
          <ChevronRightIcon className="size-4 text-muted-foreground transition-transform duration-200 group-data-panel-open:rotate-90" />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <SettingsGroup>
            <SettingsRow
              {...searchableSetting("legacy-plan-mode")}
              description={t("settings.legacy.planModeDescription")}
              control={
                <Switch
                  checked={settings.planModeEnabled}
                  onCheckedChange={(checked) => {
                    updateSettings({ planModeEnabled: Boolean(checked) });
                  }}
                  aria-label={t("settings.rows.legacy-plan-mode.title")}
                />
              }
            />
            <SettingsRow
              {...searchableSetting("legacy-context-window-indicator")}
              description={t("settings.legacy.contextWindowDescription")}
              control={
                <Switch
                  checked={settings.contextWindowMeterEnabled}
                  onCheckedChange={(checked) =>
                    updateSettings({ contextWindowMeterEnabled: Boolean(checked) })
                  }
                  aria-label={t("settings.rows.legacy-context-window-indicator.title")}
                />
              }
            />
            <SettingsRow
              {...searchableSetting("legacy-sidebar")}
              description={t("settings.legacy.sidebarDescription")}
              control={
                <Switch
                  checked={settings.legacySidebarEnabled}
                  onCheckedChange={(checked) =>
                    updateSettings({ legacySidebarEnabled: Boolean(checked) })
                  }
                  aria-label={t("settings.rows.legacy-sidebar.title")}
                />
              }
            />
          </SettingsGroup>
        </CollapsiblePanel>
      </Collapsible>
    </section>
  );
}

export function GeneralSettingsPanel() {
  const { t } = useTranslation();
  const modifierLabel = isMacPlatform(navigator.platform) ? "⌘" : "Ctrl";
  const sendShortcutOptions = [
    { value: "enter", label: t("settings.options.sendShortcut.enter") },
    {
      value: "mod-enter-multiline",
      label: t("settings.options.sendShortcut.modEnterMultiline", { modifier: modifierLabel }),
    },
    {
      value: "mod-enter",
      label: t("settings.options.sendShortcut.modEnter", { modifier: modifierLabel }),
    },
  ] as const;
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { uiLanguage, setUiLanguage } = useUiLanguage();
  const { scope, environment, connectedEnvironments, target, targets } = useSettingsScope();
  const idleCompaction = scopedIdleCompaction(targets.length > 0 ? targets : [{ settings }]);
  const environmentId = environment?.environmentId ?? null;
  const isEnvironmentScope = scope.environmentIds.length === 1 && environmentId !== null;
  const hasServerTargets = connectedEnvironments.length > 0;
  const mixedResponseStreamingMode = useScopedSettingsMixed(["responseStreamingMode"]);
  const lastEnabledProjectGroupingMode = useRef<SidebarProjectGroupingMode>(
    readLastEnabledProjectGroupingMode(),
  );
  const providersByEnvironment = useEnvironmentProviders();
  const serverProviders =
    (environment?.serverConfig
      ? providersByEnvironment.get(environment.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const supportsAutoSettlement =
    connectedEnvironments.length > 0 &&
    connectedEnvironments.every(
      (target) => target.serverConfig?.environment.capabilities.threadAutoSettlement === true,
    );
  const supportsAutoSettlementScope = connectedEnvironments.every(
    (target) => target.serverConfig?.environment.capabilities.threadAutoSettlementScope === true,
  );
  const supportsRestartContinuation =
    connectedEnvironments.length > 0 &&
    connectedEnvironments.every(
      (target) => target.serverConfig?.environment.capabilities.threadRestartContinuation === true,
    );

  const textGenerationProviders = serverProviders.filter(
    (provider) => provider.supportsTextGeneration !== false,
  );
  const textGenerationModelSelection = resolveAppModelSelectionState(
    settings,
    textGenerationProviders,
  );
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const textGenerationModelInstanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(textGenerationProviders),
      settings,
      target?.projectId ?? null,
    ),
  );
  const hasTextGenerationProvider = textGenerationModelInstanceEntries.some(
    (entry) => entry.enabled && entry.isAvailable,
  );
  const textGenInstanceEntry = textGenerationModelInstanceEntries.find(
    (entry) => entry.instanceId === textGenInstanceId,
  );
  const textGenProvider: ProviderDriverKind =
    textGenInstanceEntry?.driverKind ?? DEFAULT_DRIVER_KIND;
  const textGenerationModelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    textGenerationProviders,
    textGenInstanceId,
    textGenModel,
  );
  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const textGenerationModelDisabledReason = useScopedModelDisabledReason(
    settings,
    textGenerationModelInstanceEntries,
  );
  const mixedAddProjectBaseDirectory = useScopedSettingsMixed(["addProjectBaseDirectory"]);
  const mixedTextGenerationModel = useScopedSettingsMixed(["textGenerationModelSelection"]);

  return (
    <SettingsPageContainer>
      <SettingsSection id="language" title={t("settings.general.language.title")}>
        <SettingsRow
          title={t("settings.general.language.title")}
          description={t("settings.general.language.description")}
          control={
            <Select
              value={uiLanguage}
              onValueChange={(value) => {
                if (isUiLanguage(value)) {
                  setUiLanguage(value);
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-44"
                aria-label={t("settings.general.language.title")}
              >
                <SelectValue>
                  {uiLanguage === "system"
                    ? t("settings.general.language.systemOption")
                    : UI_LANGUAGE_NATIVE_LABELS[uiLanguage]}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {uiLanguageOptions(t("settings.general.language.systemOption")).map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>
      <ProjectDefaultsSettings category="general" />
      <SettingsSection id="organization" title={t("settings.general.sections.organization")}>
        <SettingsRow
          {...searchableSetting("project-grouping")}
          description={t("settings.rows.project-grouping.description")}
          resetAction={
            settings.sidebarProjectGroupingMode !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode ? (
              <SettingResetButton
                label="project grouping"
                onClick={() =>
                  updateSettings({
                    sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={isProjectGroupingEnabled(settings.sidebarProjectGroupingMode)}
              onCheckedChange={(checked) => {
                if (!checked && settings.sidebarProjectGroupingMode !== "separate") {
                  lastEnabledProjectGroupingMode.current = settings.sidebarProjectGroupingMode;
                  rememberEnabledProjectGroupingMode(settings.sidebarProjectGroupingMode);
                }
                updateSettings({
                  sidebarProjectGroupingMode: projectGroupingModeFromToggle(
                    checked,
                    lastEnabledProjectGroupingMode.current,
                  ),
                });
              }}
              aria-label={t("settings.rows.project-grouping.title")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("project-order")}
          description={t("settings.rows.project-order.description")}
          resetAction={
            settings.sidebarProjectSortOrder !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder ? (
              <SettingResetButton
                label="project order"
                onClick={() =>
                  updateSettings({
                    sidebarProjectSortOrder: DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sidebarProjectSortOrder}
              onValueChange={(value) => {
                if (isSidebarProjectSortOrder(value)) {
                  updateSettings({ sidebarProjectSortOrder: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-44"
                aria-label={t("settings.rows.project-order.title")}
              >
                <SelectValue>
                  {sidebarProjectSortOrderLabels(t)[settings.sidebarProjectSortOrder]}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {SidebarProjectSortOrder.literals.map((sortOrder) => (
                  <SelectItem hideIndicator key={sortOrder} value={sortOrder}>
                    {sidebarProjectSortOrderLabels(t)[sortOrder]}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          serverScoped
          {...searchableSetting("auto-resume-limited-threads")}
          description={t("settings.rows.auto-resume-limited-threads.description")}
          settingKeys={["autoResumeLimitedThreads"]}
          control={
            <ScopedSwitch
              settingKeys={["autoResumeLimitedThreads"]}
              checked={settings.autoResumeLimitedThreads}
              onCheckedChange={(checked) =>
                updateSettings({ autoResumeLimitedThreads: Boolean(checked) })
              }
              aria-label={t("settings.rows.auto-resume-limited-threads.title")}
            />
          }
        />
        <SettingsRow
          serverScoped
          {...searchableSetting("snooze-limited-threads")}
          description={t("settings.rows.snooze-limited-threads.description")}
          settingKeys={["snoozeLimitedThreads"]}
          control={
            <ScopedSwitch
              settingKeys={["snoozeLimitedThreads"]}
              checked={settings.snoozeLimitedThreads}
              onCheckedChange={(checked) =>
                updateSettings({ snoozeLimitedThreads: Boolean(checked) })
              }
              aria-label={t("settings.rows.snooze-limited-threads.title")}
            />
          }
        />

        <SettingsRow
          serverScoped
          settingKeys={["idleCompaction", "compactIdleThreads"]}
          mixed={idleCompaction.mixed}
          {...searchableSetting("compact-idle-threads")}
          description={t("settings.rows.compact-idle-threads.description")}
          resetAction={
            globalIdleCompaction(settings) !== globalIdleCompaction(DEFAULT_UNIFIED_SETTINGS) ? (
              <SettingResetButton
                label="compact idle threads"
                onClick={() =>
                  updateSettings({ idleCompaction: globalIdleCompaction(DEFAULT_UNIFIED_SETTINGS) })
                }
              />
            ) : null
          }
          control={
            <Select
              value={idleCompaction.mixed ? null : globalIdleCompaction(settings)}
              onValueChange={(value) => {
                const mode = IDLE_COMPACTION_MODES.find((candidate) => candidate.value === value);
                if (mode) updateSettings({ idleCompaction: mode.value });
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-56"
                aria-label={t("settings.rows.compact-idle-threads.title")}
              >
                <SelectValue>
                  {(value: string | null) =>
                    value === null
                      ? mixedLabel(t)
                      : IDLE_COMPACTION_MODES.find((mode) => mode.value === value)?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {IDLE_COMPACTION_MODES.map((mode) => (
                  <SelectItem
                    hideIndicator
                    key={mode.value}
                    value={mode.value}
                    // A server from before modes has only the on/off switch, so it cannot store "Never".
                    disabled={mode.value === "off" && !idleCompaction.neverAvailable}
                  >
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        {supportsAutoSettlement ? (
          <>
            <SettingsRow
              serverScoped
              settingKeys={["sidebarAutoSettleOnMerge"]}
              {...searchableSetting("auto-settle-merged-threads")}
              description={t("settings.rows.auto-settle-merged-threads.description")}
              resetAction={
                settings.sidebarAutoSettleOnMerge !==
                DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge ? (
                  <SettingResetButton
                    label="auto-settle on merge"
                    onClick={() =>
                      updateSettings({
                        sidebarAutoSettleOnMerge: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge,
                      })
                    }
                  />
                ) : null
              }
              control={
                <ScopedSwitch
                  settingKeys={["sidebarAutoSettleOnMerge"]}
                  checked={settings.sidebarAutoSettleOnMerge}
                  onCheckedChange={(checked) =>
                    updateSettings({ sidebarAutoSettleOnMerge: Boolean(checked) })
                  }
                  aria-label={t("settings.rows.auto-settle-merged-threads.title")}
                />
              }
            />

            <SettingsRow
              serverScoped
              settingKeys={["sidebarAutoSettleAfterDays"]}
              {...searchableSetting("auto-settle-inactive-threads")}
              description={t("settings.rows.auto-settle-inactive-threads.description")}
              resetAction={
                settings.sidebarAutoSettleAfterDays !==
                DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays ? (
                  <SettingResetButton
                    label="auto-settle"
                    onClick={() =>
                      updateSettings({
                        sidebarAutoSettleAfterDays:
                          DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays,
                      })
                    }
                  />
                ) : null
              }
              control={
                <ScopedSwitch
                  settingKeys={["sidebarAutoSettleAfterDays"]}
                  checked={settings.sidebarAutoSettleAfterDays !== null}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      sidebarAutoSettleAfterDays: checked ? AUTO_SETTLE_DEFAULT_DAYS : null,
                    })
                  }
                  aria-label={t("settings.rows.auto-settle-inactive-threads.title")}
                />
              }
            />
            {settings.sidebarAutoSettleAfterDays !== null ? (
              <SettingsRow
                serverScoped
                settingKeys={["sidebarAutoSettleAfterDays"]}
                title={searchableSetting("days-before-auto-settle").title}
                description={t("settings.rows.days-before-auto-settle.description")}
                control={
                  <AutoSettleDaysInput
                    value={settings.sidebarAutoSettleAfterDays}
                    onCommit={(days) => updateSettings({ sidebarAutoSettleAfterDays: days })}
                  />
                }
              />
            ) : null}
            {settings.sidebarAutoSettleAfterDays !== null && supportsAutoSettlementScope ? (
              <SettingsRow
                serverScoped
                settingKeys={["sidebarAutoSettleKeepPullRequests"]}
                title={t("settings.rows.keep-threads-with-pr.title")}
                description={t("settings.rows.keep-threads-with-pr.description")}
                control={
                  <ScopedSwitch
                    settingKeys={["sidebarAutoSettleKeepPullRequests"]}
                    checked={settings.sidebarAutoSettleKeepPullRequests}
                    onCheckedChange={(checked) =>
                      updateSettings({ sidebarAutoSettleKeepPullRequests: checked })
                    }
                    aria-label={t("settings.rows.keep-threads-with-pr.title")}
                  />
                }
              />
            ) : null}
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection id="behavior" title={t("settings.general.sections.behavior")}>
        <NotificationSettings />
        <SettingsRow
          {...searchableSetting("in-app-notifications")}
          description={t("settings.rows.in-app-notifications.description")}
          control={
            <Switch
              checked={settings.inAppNotificationsEnabled}
              onCheckedChange={(checked) => updateSettings({ inAppNotificationsEnabled: checked })}
              aria-label={t("settings.rows.in-app-notifications.title")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("time-format")}
          description={t("settings.rows.time-format.description")}
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label="time format"
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("settings.rows.time-format.title")}
              >
                <SelectValue>{timestampFormatLabels(t)[settings.timestampFormat]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {timestampFormatLabels(t).locale}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {timestampFormatLabels(t)["12-hour"]}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {timestampFormatLabels(t)["24-hour"]}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["responseStreamingMode"]}
          {...searchableSetting("response-streaming")}
          description={
            mixedResponseStreamingMode
              ? t("settings.rows.response-streaming.mixedDescription")
              : responseStreamingModeDescriptions(t)[settings.responseStreamingMode]
          }
          resetAction={
            settings.responseStreamingMode !== DEFAULT_UNIFIED_SETTINGS.responseStreamingMode ? (
              <SettingResetButton
                label="response streaming"
                onClick={() =>
                  updateSettings({
                    responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={mixedResponseStreamingMode ? null : settings.responseStreamingMode}
              onValueChange={(value) => {
                if (value === "turn" || value === "paragraph") {
                  updateSettings({ responseStreamingMode: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-56"
                aria-label={t("settings.rows.response-streaming.title")}
              >
                <SelectValue>
                  {(value: ResponseStreamingMode | null) =>
                    value === null ? mixedLabel(t) : responseStreamingModeLabels(t)[value]
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="turn">
                  {responseStreamingModeLabels(t).turn}
                </SelectItem>
                <SelectItem hideIndicator value="paragraph">
                  {responseStreamingModeLabels(t).paragraph}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("hide-whitespace-changes")}
          description={t("settings.rows.hide-whitespace-changes.description")}
          resetAction={
            settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace ? (
              <SettingResetButton
                label="diff whitespace changes"
                onClick={() =>
                  updateSettings({
                    diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffIgnoreWhitespace}
              onCheckedChange={(checked) =>
                updateSettings({ diffIgnoreWhitespace: Boolean(checked) })
              }
              aria-label={t("settings.rows.hide-whitespace-changes.title")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("default-diff-file-state")}
          description={t("settings.rows.default-diff-file-state.description")}
          resetAction={
            settings.diffFilesCollapsed !== DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed ? (
              <SettingResetButton
                label="default diff file state"
                onClick={() =>
                  updateSettings({
                    diffFilesCollapsed: DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.diffFilesCollapsed ? "collapsed" : "expanded"}
              onValueChange={(value) => {
                if (value === "expanded" || value === "collapsed") {
                  updateSettings({ diffFilesCollapsed: value === "collapsed" });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("settings.rows.default-diff-file-state.title")}
              >
                <SelectValue>
                  {settings.diffFilesCollapsed
                    ? t("settings.options.diffState.collapsed")
                    : t("settings.options.diffState.expanded")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="expanded">
                  {t("settings.options.diffState.expanded")}
                </SelectItem>
                <SelectItem hideIndicator value="collapsed">
                  {t("settings.options.diffState.collapsed")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("diff-layout")}
          description={t("settings.rows.diff-layout.description")}
          resetAction={
            settings.diffLayout !== DEFAULT_UNIFIED_SETTINGS.diffLayout ? (
              <SettingResetButton
                label="diff layout"
                onClick={() => updateSettings({ diffLayout: DEFAULT_UNIFIED_SETTINGS.diffLayout })}
              />
            ) : null
          }
          control={
            <Select
              value={settings.diffLayout}
              onValueChange={(value) => {
                if (value === "stacked" || value === "split") {
                  updateSettings({ diffLayout: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("settings.rows.diff-layout.title")}
              >
                <SelectValue>{diffLayoutLabels(t)[settings.diffLayout]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="stacked">
                  {diffLayoutLabels(t).stacked}
                </SelectItem>
                <SelectItem hideIndicator value="split">
                  {diffLayoutLabels(t).split}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          {...searchableSetting("proactive-panels")}
          description={t("settings.rows.proactive-panels.description")}
          resetAction={
            settings.proactivePanelsEnabled !== DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled ? (
              <SettingResetButton
                label="proactive panels"
                onClick={() =>
                  updateSettings({
                    proactivePanelsEnabled: DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.proactivePanelsEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ proactivePanelsEnabled: Boolean(checked) })
              }
              aria-label={t("settings.rows.proactive-panels.title")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("skills-in-slash-menu")}
          description={t("settings.rows.skills-in-slash-menu.description")}
          resetAction={
            settings.showSkillsInSlashMenu !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu ? (
              <SettingResetButton
                label="skills in slash menu"
                onClick={() =>
                  updateSettings({
                    showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.showSkillsInSlashMenu}
              onCheckedChange={(checked) =>
                updateSettings({ showSkillsInSlashMenu: Boolean(checked) })
              }
              aria-label={t("settings.rows.skills-in-slash-menu.title")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("composer-rich-text")}
          description={t("settings.rows.composer-rich-text.description")}
          resetAction={
            settings.composerRichTextEnabled !==
            DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled ? (
              <SettingResetButton
                label="rich text composer"
                onClick={() =>
                  updateSettings({
                    composerRichTextEnabled: DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.composerRichTextEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ composerRichTextEnabled: Boolean(checked) })
              }
              aria-label={t("settings.rows.composer-rich-text.title")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("composer-collapse")}
          description={t("settings.rows.composer-collapse.description")}
          resetAction={
            settings.composerCollapseOnScroll !==
            DEFAULT_UNIFIED_SETTINGS.composerCollapseOnScroll ? (
              <SettingResetButton
                label="collapse composer on scroll"
                onClick={() =>
                  updateSettings({
                    composerCollapseOnScroll: DEFAULT_UNIFIED_SETTINGS.composerCollapseOnScroll,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.composerCollapseOnScroll}
              onCheckedChange={(checked) =>
                updateSettings({ composerCollapseOnScroll: Boolean(checked) })
              }
              aria-label={t("settings.rows.composer-collapse.title")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("send-shortcut")}
          description={t("settings.rows.send-shortcut.description")}
          resetAction={
            settings.sendShortcut !== DEFAULT_UNIFIED_SETTINGS.sendShortcut ? (
              <SettingResetButton
                label="send shortcut"
                onClick={() =>
                  updateSettings({ sendShortcut: DEFAULT_UNIFIED_SETTINGS.sendShortcut })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sendShortcut}
              onValueChange={(value) => {
                const option = sendShortcutOptions.find((option) => option.value === value);
                if (option) updateSettings({ sendShortcut: option.value });
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-auto min-w-0 max-w-full"
                aria-label="Send shortcut"
              >
                <SelectValue>
                  {
                    sendShortcutOptions.find((option) => option.value === settings.sendShortcut)
                      ?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {sendShortcutOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="flex items-center justify-between gap-4">
                      {option.label}
                      {settings.sendShortcut === option.value && <CheckIcon aria-hidden="true" />}
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          {...searchableSetting("follow-up-behavior")}
          description={
            t("settings.rows.follow-up-behavior.description") +
            (settings.sendShortcut === "mod-enter-multiline"
              ? t("settings.rows.follow-up-behavior.hintMultiline", { modifier: modifierLabel })
              : t("settings.rows.follow-up-behavior.hint", {
                  modifier: modifierLabel,
                  shift:
                    settings.sendShortcut === "mod-enter"
                      ? t("settings.rows.follow-up-behavior.shift")
                      : "",
                }))
          }
          resetAction={
            settings.followUpBehavior !== DEFAULT_UNIFIED_SETTINGS.followUpBehavior ? (
              <SettingResetButton
                label="follow-up behavior"
                onClick={() =>
                  updateSettings({
                    followUpBehavior: DEFAULT_UNIFIED_SETTINGS.followUpBehavior,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.followUpBehavior}
              onValueChange={(value) => {
                if (value === "queue" || value === "steer") {
                  updateSettings({ followUpBehavior: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-auto min-w-0"
                aria-label={t("settings.rows.follow-up-behavior.title")}
              >
                <SelectValue>
                  {settings.followUpBehavior === "queue"
                    ? t("settings.options.followUp.queue")
                    : t("settings.options.followUp.steer")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="queue">{t("settings.options.followUp.queue")}</SelectItem>
                <SelectItem value="steer">{t("settings.options.followUp.steer")}</SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          serverScoped
          settingKeys={["enableProviderUpdateChecks"]}
          {...searchableSetting("provider-update-checks")}
          description={t("settings.rows.provider-update-checks.description")}
          resetAction={
            settings.enableProviderUpdateChecks !==
            DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks ? (
              <SettingResetButton
                label="provider update checks"
                onClick={() =>
                  updateSettings({
                    enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["enableProviderUpdateChecks"]}
              checked={settings.enableProviderUpdateChecks}
              onCheckedChange={(checked) =>
                updateSettings({ enableProviderUpdateChecks: Boolean(checked) })
              }
              aria-label={t("settings.rows.provider-update-checks.aria")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("continue-threads-after-server-update")}
          serverScoped
          settingKeys={["continueThreadsAfterServerUpdate"]}
          description={t("settings.rows.continue-threads-after-server-update.description")}
          status={
            !supportsRestartContinuation
              ? t("settings.rows.continue-threads-after-server-update.unsupported")
              : undefined
          }
          resetAction={
            supportsRestartContinuation &&
            settings.continueThreadsAfterServerUpdate !==
              DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate ? (
              <SettingResetButton
                label="continue threads after restarts"
                onClick={() =>
                  updateSettings({
                    continueThreadsAfterServerUpdate:
                      DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["continueThreadsAfterServerUpdate"]}
              checked={settings.continueThreadsAfterServerUpdate}
              disabled={!supportsRestartContinuation}
              onCheckedChange={(checked) =>
                updateSettings({ continueThreadsAfterServerUpdate: Boolean(checked) })
              }
              aria-label={t("settings.rows.continue-threads-after-server-update.title")}
            />
          }
        />

        <BackgroundActivitySettingsRow />
      </SettingsSection>

      <SettingsSection
        id="projects-and-threads"
        title={t("settings.general.sections.projectsAndThreads")}
      >
        <SettingsRow
          serverScoped
          settingKeys={["newWorktreesStartFromOrigin"]}
          {...searchableSetting("start-from-origin")}
          description={t("settings.rows.start-from-origin.description")}
          resetAction={
            settings.newWorktreesStartFromOrigin !==
            DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin ? (
              <SettingResetButton
                label="new worktrees start from remote"
                onClick={() =>
                  updateSettings({
                    newWorktreesStartFromOrigin:
                      DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["newWorktreesStartFromOrigin"]}
              checked={settings.newWorktreesStartFromOrigin}
              onCheckedChange={(checked) =>
                updateSettings({ newWorktreesStartFromOrigin: Boolean(checked) })
              }
              aria-label={t("settings.rows.start-from-origin.aria")}
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["addProjectBaseDirectory"]}
          {...searchableSetting("add-project-starts-in")}
          description={t("settings.rows.add-project-starts-in.description")}
          resetAction={
            settings.addProjectBaseDirectory !==
            DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory ? (
              <SettingResetButton
                label="add project base directory"
                onClick={() =>
                  updateSettings({
                    addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
                  })
                }
              />
            ) : null
          }
          control={
            <DraftInput
              size="sm"
              className="w-full sm:w-72"
              value={mixedAddProjectBaseDirectory ? "" : settings.addProjectBaseDirectory}
              onCommit={(next) => updateSettings({ addProjectBaseDirectory: next })}
              placeholder={mixedAddProjectBaseDirectory ? mixedLabel(t) : "~/"}
              spellCheck={false}
              aria-label={t("settings.rows.add-project-starts-in.title")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="confirmations" title={t("settings.general.sections.confirmations")}>
        <SettingsRow
          {...searchableSetting("unpin-confirmation")}
          description={t("settings.rows.unpin-confirmation.description")}
          resetAction={
            settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin ? (
              <SettingResetButton
                label="unpin confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadUnpin}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadUnpin: Boolean(checked) })
              }
              aria-label={t("settings.rows.unpin-confirmation.aria")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("archive-confirmation")}
          description={t("settings.rows.archive-confirmation.description")}
          resetAction={
            settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
              <SettingResetButton
                label="archive confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadArchive}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadArchive: Boolean(checked) })
              }
              aria-label={t("settings.rows.archive-confirmation.aria")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("delete-confirmation")}
          description={t("settings.rows.delete-confirmation.description")}
          resetAction={
            settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
              <SettingResetButton
                label="delete confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadDelete}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadDelete: Boolean(checked) })
              }
              aria-label={t("settings.rows.delete-confirmation.aria")}
            />
          }
        />

        {isElectron ? (
          <SettingsRow
            {...searchableSetting("quit-confirmation")}
            description={t("settings.rows.quit-confirmation.description")}
            resetAction={
              settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit ? (
                <SettingResetButton
                  label="quit shortcut behavior"
                  onClick={() =>
                    updateSettings({ confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.confirmQuit}
                onValueChange={(value) => {
                  if (value === "direct" || value === "hold" || value === "double-click") {
                    updateSettings({ confirmQuit: value });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={t("settings.rows.quit-confirmation.aria")}
                >
                  <SelectValue>{quitConfirmationModeLabels(t)[settings.confirmQuit]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {Object.entries(quitConfirmationModeLabels(t)).map(([value, label]) => (
                    <SelectItem hideIndicator key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        ) : null}
      </SettingsSection>

      <SettingsSection id="text-generation" title={t("settings.general.sections.textGeneration")}>
        <SettingsRow
          serverScoped
          settingKeys={["textGenerationModelSelection"]}
          {...searchableSetting("text-generation-model")}
          description={t("settings.rows.text-generation-model.description")}
          resetAction={
            hasServerTargets && isTextGenerationModelDirty ? (
              <SettingResetButton
                label="text generation model"
                onClick={() =>
                  updateSettings({
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            !hasServerTargets ? (
              <span className="text-sm text-muted-foreground">
                {t("settings.general.textGeneration.connectPrompt")}
              </span>
            ) : !hasTextGenerationProvider ? (
              <span className="text-sm text-muted-foreground">
                {t("settings.general.textGeneration.noProviders")}
              </span>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <ProviderModelPicker
                  environmentId={environmentId}
                  activeInstanceId={textGenInstanceId}
                  model={textGenModel}
                  lockedProvider={null}
                  instanceEntries={textGenerationModelInstanceEntries}
                  modelOptionsByInstance={textGenerationModelOptionsByInstance}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  {...(mixedTextGenerationModel ? { triggerLabel: mixedLabel(t) } : {})}
                  getModelDisabledReason={textGenerationModelDisabledReason}
                  {...(environmentId
                    ? {
                        onOpenProviderSetup: (instanceId: ProviderInstanceId) => {
                          void navigate({
                            to: "/settings/providers",
                            search: { environmentId, instanceId },
                          });
                        },
                      }
                    : {})}
                  onInstanceModelChange={(instanceId, model) => {
                    const reason = textGenerationModelDisabledReason(instanceId, model);
                    if (reason) {
                      toastManager.add({
                        type: "error",
                        title: t("settings.general.textGeneration.notSavedTitle"),
                        description: reason,
                      });
                      return;
                    }
                    updateSettings({
                      textGenerationModelSelection: resolveAppModelSelectionState(
                        {
                          ...settings,
                          textGenerationModelSelection: createModelSelection(instanceId, model),
                        },
                        textGenerationProviders,
                      ),
                    });
                  }}
                />
                {textGenInstanceEntry ? (
                  <TraitsPicker
                    provider={textGenProvider}
                    models={textGenInstanceEntry?.models ?? []}
                    model={textGenModel}
                    modelOptions={textGenModelOptions}
                    allowPromptInjectedEffort={false}
                    planModeEnabled={
                      settings.planModeEnabled || selectsPlanAgent(textGenModelOptions)
                    }
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    onModelOptionsChange={(nextOptions) => {
                      updateSettings({
                        textGenerationModelSelection: resolveAppModelSelectionState(
                          {
                            ...settings,
                            textGenerationModelSelection: createModelSelection(
                              textGenInstanceId,
                              textGenModel,
                              nextOptions,
                            ),
                          },
                          textGenerationProviders,
                        ),
                      });
                    }}
                  />
                ) : null}
              </div>
            )
          }
        />
        <ThreadTitleInstructionsSettings />
      </SettingsSection>

      <SettingsSection id="about" title={t("settings.general.sections.about")}>
        {isElectron || HOSTED_APP_CHANNEL ? (
          <AboutVersionSection />
        ) : (
          <>
            <SettingsRow
              id={searchableSetting("app-version").id}
              title={<AboutVersionTitle />}
              description={t("settings.update.currentVersion")}
            />
          </>
        )}
        <MobileAppSettingsRow />
        <SettingsRow
          {...searchableSetting("privacy-policy")}
          description={t("settings.rows.privacy-policy.description")}
          control={
            <Button
              render={<a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer noopener" />}
              size="sm"
              variant="outline"
            >
              {t("settings.general.about.viewPolicy")}
            </Button>
          }
        />
      </SettingsSection>
      <SettingsSection title={t("settings.general.sections.diagnostics")}>
        <SettingsRow
          {...searchableSetting("diagnostics")}
          description={
            isEnvironmentScope
              ? t("settings.rows.diagnostics.descriptionEnvironment")
              : t("settings.rows.diagnostics.descriptionAll")
          }
          control={
            <Button
              render={
                <Link to="/settings/diagnostics" search={{ machine: environmentId ?? undefined }} />
              }
              size="sm"
              variant="outline"
            >
              {t("settings.general.about.viewDiagnostics")}
            </Button>
          }
        />
        <SettingsRow
          {...searchableSetting("open-source-licenses")}
          description={t("settings.rows.open-source-licenses.description")}
          control={
            <Button
              render={<Link to="/settings/open-source-licenses" />}
              size="sm"
              variant="outline"
            >
              {t("settings.general.about.viewLicenses")}
            </Button>
          }
        />
      </SettingsSection>

      <LegacyFeaturesSection />
    </SettingsPageContainer>
  );
}
