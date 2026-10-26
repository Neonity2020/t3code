import { HOSTED_APP_CHANNEL } from "~/branding";
import { isElectron } from "~/env";
import { isMacPlatform, isWindowsPlatform, normalizeSearchText } from "~/lib/utils";
import i18next, { settingsSectionKey } from "~/i18n";
import { STATIC_KEYBINDING_COMMANDS, type KeybindingCommand } from "@t3tools/contracts";
import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import {
  sourceControlClients,
  type SourceControlDefinition,
} from "@t3tools/client-runtime/source-control-clients";
import { DEFAULT_KEYBINDINGS } from "@t3tools/shared/keybindings";
import * as Schema from "effect/Schema";
import { TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "../../appearanceFonts";
import { writeLocalStorageValue } from "../../hooks/useLocalStorage";
import { commandLabel } from "./KeybindingsSettings.logic";
import {
  validateSettingsScopeSearch,
  type ResolvedSettingsScope,
  type SettingsScopeSearch,
} from "./settingsScope";

export type SettingsPath =
  | "/settings/projects"
  | "/settings/general"
  | "/settings/diagnostics"
  | "/settings/appearance"
  | "/settings/keybindings"
  | "/settings/snap-shot"
  | "/settings/providers"
  | "/settings/integrations"
  | "/settings/scheduled-tasks"
  | "/settings/source-control"
  | "/settings/storage"
  | "/settings/connections"
  | "/settings/beta"
  | "/settings/archived";

export type SettingsSearchScope =
  | "environment"
  | "environment-defaults"
  | "project-defaults"
  | "project"
  | "checkout"
  | "connections";

export interface SettingsSearchItem {
  readonly id: string;
  readonly title: string;
  readonly to: SettingsPath;
  readonly targetId?: string;
  readonly searchTerms?: ReadonlyArray<string>;
  readonly scope?: SettingsSearchScope;
  readonly desktopOnly?: boolean;
  readonly macOnly?: boolean;
  readonly windowsOnly?: boolean;
  readonly releaseChannelOnly?: boolean;
  readonly cloudOnly?: boolean;
  readonly environmentOnly?: boolean;
  readonly providerSettingsOnly?: boolean;
  readonly macProviderSettingsOnly?: boolean;
  readonly localBackendManagementOnly?: boolean;
  readonly localEnvironmentOnly?: boolean;
  readonly wslAvailableOnly?: boolean;
  readonly managedTunnelOnly?: boolean;
  readonly secondary?: boolean;
  readonly requiresThreadAutoSettlement?: boolean;
}

export interface SettingsSearchAvailability {
  readonly localEnvironmentDisabled?: boolean;
  readonly hasCloudPublicConfig: boolean;
  readonly hasEnvironment: boolean;
  readonly hasProviderSettingsEnvironment: boolean;
  readonly hasMacProviderSettingsEnvironment: boolean;
  readonly canManageLocalBackend: boolean;
  readonly isWslSettingsRowVisible: boolean;
  readonly hasThreadAutoSettlement: boolean;
  readonly managedTunnelActive?: boolean;
}

export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsPath, string>> = {
  "/settings/diagnostics": "Diagnostics",
  "/settings/projects": "Project",
  "/settings/general": "General",
  "/settings/appearance": "Appearance",
  "/settings/keybindings": "Keybindings",
  "/settings/snap-shot": "SnapShots",
  "/settings/providers": "Providers",
  "/settings/integrations": "Integrations",
  "/settings/scheduled-tasks": "Scheduled tasks",
  "/settings/source-control": "Source control",
  "/settings/storage": "Storage",
  "/settings/connections": "Connections",
  "/settings/beta": "Beta",
  "/settings/archived": "Archive",
};

/**
 * Localized section label; falls back to the English registry entry when a translation is missing.
 * Call from render paths. Components that must re-render on language change subscribe via useTranslation.
 */
export function settingsSectionLabel(path: SettingsPath): string {
  return i18next.t(settingsSectionKey(path), { defaultValue: SETTINGS_SECTION_LABELS[path] });
}

export function keybindingSearchAnchorId<Command extends KeybindingCommand>(command: Command) {
  return `keybinding-${command}` as const;
}

const KEYBINDING_SEARCH_ITEMS = STATIC_KEYBINDING_COMMANDS.toSorted((left, right) =>
  commandLabel(left).localeCompare(commandLabel(right)),
).map((command) => {
  const defaultKeys = DEFAULT_KEYBINDINGS.filter((binding) => binding.command === command).map(
    (binding) => binding.key,
  );
  return {
    id: keybindingSearchAnchorId(command),
    title: commandLabel(command),
    to: "/settings/keybindings" as const,
    searchTerms: [command, ...defaultKeys],
    secondary: true,
    ...(defaultKeys.length === 0 ? { targetId: "keybindings" } : {}),
  };
});

export function sourceControlHostSettingsSearchId(kind: string) {
  return `source-control-host-${kind}` as const;
}

/** Each host's own settings: its accounts and token, or the fields of its settings form. */
export function sourceControlHostSearchItems(
  definitions: ReadonlyArray<SourceControlDefinition>,
): ReadonlyArray<
  SettingsSearchItem & { readonly id: ReturnType<typeof sourceControlHostSettingsSearchId> }
> {
  return definitions.flatMap((definition) => {
    if (!definition.settings) return [];
    const names = [definition.label, ...(definition.searchKeywords ?? [])].join(" ");
    const { credentials } = definition;
    return [
      {
        id: sourceControlHostSettingsSearchId(definition.kind),
        title: credentials
          ? `${definition.label} accounts and token`
          : `${definition.label} credentials`,
        to: "/settings/source-control" as const,
        searchTerms: [
          credentials
            ? `${names} ${credentials.cliName} account login user host switch multiple accounts disable sign in token personal access token pat api key credential`
            : `${names} ${Object.keys(definition.settings.fields).join(" ")} token credentials sign in`,
        ],
        environmentOnly: true,
        scope: "environment-defaults" as const,
      },
    ];
  });
}

/** For settings that apply to every host. */
const SOURCE_CONTROL_HOST_LABELS = sourceControlClients.definitions
  .map((definition) => definition.label)
  .join(" ");
const SOURCE_CONTROL_HOST_TERMS = sourceControlClients.definitions
  .flatMap((definition) => [definition.label, ...(definition.searchKeywords ?? [])])
  .join(" ");

export const SETTINGS_SEARCH_ITEMS = [
  {
    id: "storage-worktree-keep-when",
    targetId: "storage-worktrees",
    title: "Keep worktrees with local changes",
    to: "/settings/storage",
    scope: "project-defaults",
    searchTerms: [
      "any local files uncommitted changes edited tracked files ignored env build output cleanup",
    ],
  },
  {
    id: "storage-delete-now",
    title: "Delete now",
    to: "/settings/storage",
    scope: "environment-defaults",
    searchTerms: ["storage cleanup run now results report removed kept failed"],
  },
  {
    id: "storage-worktrees",
    title: "Worktree cleanup",
    to: "/settings/storage",
    scope: "project-defaults",
    searchTerms: [
      "disk storage delete deleted archived threads old inactive merged unchanged worktrees retention days project inherit off custom",
    ],
  },
  {
    id: "storage-worktrees-location",
    title: "Worktree location",
    to: "/settings/storage",
    scope: "environment-defaults",
    searchTerms: ["worktree location folder directory path drive external disk"],
  },
  {
    id: "storage-artifacts",
    title: "Artifacts and logs",
    to: "/settings/storage",
    scope: "environment-defaults",
    searchTerms: ["disk storage browser screenshots captures rotated logs cleanup retention"],
  },
  {
    id: "project-defaults",
    title: "Project defaults and overrides",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: ["model workspace environments projects inheritance checkout"],
  },
  {
    id: "project-overview",
    title: "Project overview",
    to: "/settings/projects",
    searchTerms: ["name icon emoji image checkout remove delete"],
  },
  {
    id: "default-model",
    title: "Default model",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: ["new thread project provider reasoning effort"],
  },
  {
    id: "default-permissions",
    title: "Permissions",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [
      "new thread default runtime mode supervised approvals auto accept edits full access",
    ],
  },
  {
    id: "color-scheme",
    title: "Color scheme",
    to: "/settings/appearance",
    searchTerms: ["appearance light dark system mode"],
    targetId: "appearance",
  },
  {
    id: "theme",
    title: "Themes",
    to: "/settings/appearance",
    searchTerms: ["appearance colors palette custom import"],
    targetId: "appearance",
  },
  {
    // Prefixed because the slider control already owns the `appearance-contrast` id.
    id: "setting-appearance-contrast",
    title: "Contrast",
    to: "/settings/appearance",
    searchTerms: ["colors borders interface"],
  },
  {
    // Prefixed because the slider control already owns the `glass-opacity` id.
    id: "setting-glass-opacity",
    title: "Glass opacity",
    to: "/settings/appearance",
    searchTerms: ["transparent transparency solid menus dialogs composer"],
  },
  {
    id: "diff-color-scheme",
    title: "Diff colors",
    to: "/settings/appearance",
    searchTerms: ["red green blue orange additions deletions changes counts palette colorblind"],
  },
  {
    id: "chat-width",
    title: "Chat width",
    to: "/settings/appearance",
    searchTerms: ["wide full width column layout messages composer monitor"],
  },
  {
    id: "math-rendering",
    title: "Render math",
    to: "/settings/appearance",
    searchTerms: ["latex tex katex equations formulas markdown"],
  },
  {
    id: "panel-animations",
    title: "Panel animations",
    to: "/settings/appearance",
  },
  {
    id: "environment-identification",
    title: "Environment identification",
    to: "/settings/appearance",
    searchTerms: ["dev nightly artwork pill label hide none"],
    targetId: "appearance-interface",
  },
  {
    id: "interface-font",
    title: "Interface font",
    to: "/settings/appearance",
    searchTerms: ["typography family size system sans"],
  },
  {
    id: "prompt-font",
    title: "Prompt font",
    to: "/settings/appearance",
    searchTerms: ["typography family size composer input"],
  },
  {
    id: "code-font",
    title: "Code font",
    to: "/settings/appearance",
    searchTerms: ["typography family size monospace code blocks diffs file previews"],
  },
  {
    id: "terminal-font",
    title: "Terminal font",
    to: "/settings/appearance",
    searchTerms: ["typography family size monospace output"],
  },
  {
    id: "font-smoothing",
    title: "Font smoothing",
    to: "/settings/appearance",
    searchTerms: ["typography text grayscale anti aliasing macos thin"],
    macOnly: true,
  },
  {
    id: "word-wrap",
    title: "Word wrap",
    to: "/settings/appearance",
    searchTerms: ["long lines code blocks tables diffs file previews"],
  },
  {
    id: "composer-context",
    title: "Composer context",
    to: "/settings/appearance",
  },
  {
    id: "project-grouping",
    title: "Project grouping",
    to: "/settings/general",
    searchTerms: ["combine matching repositories environments sidebar"],
  },
  {
    id: "project-order",
    title: "Project order",
    to: "/settings/general",
    searchTerms: ["sort projects sidebar manual created recent"],
  },
  {
    id: "snooze-limited-threads",
    title: "Snooze until limits reset",
    to: "/settings/general",
    searchTerms: ["usage quota rate limit reset wake recover continue"],
  },
  {
    id: "auto-resume-limited-threads",
    title: "Resume after usage limits",
    to: "/settings/general",
    searchTerms: ["usage quota rate limit reset recover continue"],
  },
  {
    id: "new-design",
    title: "New design",
    to: "/settings/beta",
    searchTerms: ["beta redesign look style sidebar composer black quieter classic"],
  },
  {
    id: "working-shelf",
    title: "Working section",
    to: "/settings/beta",
    searchTerms: ["beta hide fold running monitoring threads inbox sidebar shelf"],
  },
  {
    id: "guest-links",
    title: "Guest links",
    to: "/settings/beta",
    scope: "environment",
    searchTerms: ["beta share guest invite link teammate watch t3 connect tunnel"],
  },
  {
    id: "auto-settle-inactive-threads",
    title: "Auto-settle inactive threads",
    to: "/settings/general",
    searchTerms: ["sidebar inactivity days no activity automatically"],
    requiresThreadAutoSettlement: true,
    scope: "project-defaults",
  },
  {
    id: "compact-idle-threads",
    title: "Compact idle threads",
    to: "/settings/general",
    scope: "environment-defaults",
    searchTerms: ["claude context compaction idle cache tokens usage summary resume"],
  },
  {
    id: "auto-settle-merged-threads",
    title: "Auto-settle merged threads",
    to: "/settings/general",
    searchTerms: ["pull request merge closed automatically sidebar"],
    requiresThreadAutoSettlement: true,
    scope: "project-defaults",
  },
  {
    id: "days-before-auto-settle",
    title: "Days of inactivity before auto-settle",
    to: "/settings/general",
    targetId: "auto-settle-inactive-threads",
    searchTerms: ["thread timeout activity sidebar"],
    requiresThreadAutoSettlement: true,
    scope: "project-defaults",
  },
  {
    id: "thread-notifications",
    title: "Thread notifications",
    to: "/settings/general",
    searchTerms: ["notification sound alert completion input approval desktop"],
  },
  {
    id: "in-app-notifications",
    title: "In-app notifications",
    to: "/settings/general",
    searchTerms: ["notification toast popup completion input approval failure"],
  },
  {
    id: "time-format",
    title: "Time format",
    to: "/settings/general",
    searchTerms: ["timestamp clock locale system browser os 12 hour 24 hour"],
  },
  {
    id: "response-streaming",
    title: "Response streaming",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: ["output token paragraph buffered wait turn legacy"],
  },
  {
    id: "hide-whitespace-changes",
    title: "Hide whitespace changes",
    to: "/settings/general",
    searchTerms: ["diff ignore spaces edits default"],
  },
  {
    id: "default-diff-file-state",
    title: "Default diff file state",
    to: "/settings/general",
    searchTerms: ["collapsed expanded collapse expand files pull request pr code tab"],
  },
  {
    id: "diff-layout",
    title: "Diff layout",
    to: "/settings/general",
    searchTerms: ["stacked split side by side unified inline view"],
  },
  {
    id: "proactive-panels",
    title: "Proactive panels",
    to: "/settings/general",
    searchTerms: ["automatically open diff pull request pr right panel agent completion"],
  },
  {
    id: "skills-in-slash-menu",
    title: "Show skills in slash menu",
    to: "/settings/general",
    searchTerms: ["command menu dollar $ slash /"],
  },
  {
    id: "composer-rich-text",
    title: "Rich text composer",
    to: "/settings/general",
    searchTerms: ["composer rich text tiptap bold italic markdown styled wysiwyg"],
  },
  {
    id: "composer-collapse",
    title: "Collapse composer on scroll",
    to: "/settings/general",
    searchTerms: ["composer rest resting scroll wheel conversation timeline shrink minimize"],
  },
  {
    id: "send-shortcut",
    title: "Send shortcut",
    to: "/settings/general",
    searchTerms: ["enter return command ctrl multiline prompt new line composer"],
  },
  {
    id: "follow-up-behavior",
    title: "Follow-up behavior",
    to: "/settings/general",
    searchTerms: ["queue steer running turn send default behavior composer"],
  },
  {
    id: "provider-update-checks",
    title: "Provider update checks",
    to: "/settings/general",
    searchTerms: ["installed cli versions newer available codex claude cursor grok opencode"],
    scope: "environment-defaults",
  },
  {
    id: "continue-threads-after-server-update",
    title: "Continue threads after restarts",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [
      "resume running active interrupted work restart reboot machine crash desktop update automatically",
    ],
  },
  {
    id: "background-activity",
    title: "Background activity",
    to: "/settings/general",
    scope: "environment-defaults",
    searchTerms: [
      "balanced performance battery saver advanced git fetch provider health refresh host power monitor idle policy",
    ],
  },
  {
    id: "new-threads",
    title: "New threads",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: ["default workspace mode draft local worktree"],
  },
  {
    id: "worktree-submodules",
    title: "Submodules",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: ["git submodule init recursive top-level none worktree t3.json"],
  },
  {
    id: "start-from-origin",
    title: "Start from remote",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: ["new worktrees start remote origin latest fetched branch local"],
  },
  {
    id: "add-project-starts-in",
    title: "Add project starts in",
    to: "/settings/general",
    scope: "environment-defaults",
    searchTerms: ["base directory folder browser path home"],
  },
  {
    id: "unpin-confirmation",
    title: "Unpin confirmation",
    to: "/settings/general",
    searchTerms: ["ask before thread pinned section"],
  },
  {
    id: "archive-confirmation",
    title: "Archive confirmation",
    to: "/settings/general",
    searchTerms: ["ask before thread second click inline action"],
  },
  {
    id: "delete-confirmation",
    title: "Delete confirmation",
    to: "/settings/general",
    searchTerms: ["ask before thread chat history"],
  },
  {
    id: "quit-confirmation",
    title: "Quit shortcut",
    to: "/settings/general",
    searchTerms: ["confirmation desktop app exit direct hold double click press twice"],
    desktopOnly: true,
  },
  {
    id: "text-generation-model",
    title: "Text generation model",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: ["generated thread titles source control content default provider"],
  },
  {
    id: "thread-title-instructions",
    title: "Thread title instructions",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: ["generated thread titles prompt custom style naming rename regenerate"],
  },
  {
    id: "app-version",
    title: "Version",
    to: "/settings/general",
    searchTerms: ["about check for updates download install upgrade release"],
  },
  {
    id: "update-track",
    title: "Update track",
    to: "/settings/general",
    searchTerms: ["release channel stable latest nightly prerelease"],
    releaseChannelOnly: true,
  },
  {
    id: "cli-command",
    title: "t3 command",
    to: "/settings/general",
    searchTerms: ["cli terminal shell path install command line"],
    desktopOnly: true,
  },
  {
    id: "mobile-app",
    title: "Mobile app",
    to: "/settings/general",
    searchTerms: ["phone tablet iPhone iPad iOS Android App Store Google Play QR"],
  },
  {
    id: "privacy-policy",
    title: "Privacy policy",
    to: "/settings/general",
    searchTerms: ["telemetry analytics usage data tracking legal opt out"],
  },
  {
    id: "telemetry-export",
    title: "OpenTelemetry export",
    to: "/settings/diagnostics",
    targetId: "telemetry-export",
    scope: "environment",
    searchTerms: ["OTel OTLP telemetry export endpoints logs traces metrics Grafana"],
  },
  {
    id: "diagnostics",
    title: "Diagnostics",
    to: "/settings/general",
    searchTerms: ["logs traces processes resource history failures spans cpu memory"],
  },
  {
    id: "open-source-licenses",
    title: "Open source licenses",
    to: "/settings/general",
  },
  {
    id: "legacy-plan-mode",
    title: "Plan mode (legacy)",
    to: "/settings/general",
    searchTerms: ["build plan composer old"],
  },
  {
    id: "legacy-context-window-indicator",
    title: "Context window indicator (legacy)",
    to: "/settings/general",
    searchTerms: ["composer meter usage tokens circle old"],
  },
  {
    id: "legacy-sidebar",
    title: "Sidebar (legacy)",
    to: "/settings/general",
    searchTerms: ["project thread tree old flat list"],
  },
  {
    id: "keybindings",
    title: "Keybindings",
    to: "/settings/keybindings",
    searchTerms: ["keyboard shortcuts hotkeys commands bindings json"],
  },
  ...KEYBINDING_SEARCH_ITEMS,
  {
    id: "snap-shot-enabled",
    title: "SnapShots",
    searchTerms: ["window capture screenshot"],
    to: "/settings/snap-shot",
  },
  {
    id: "snap-shot-accessibility",
    title: "Include app text",
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
    searchTerms: [
      "capture accessibility data text UI structure elements privacy omit agent context",
    ],
  },
  {
    id: "snap-shot-shortcut",
    title: "Capture shortcut",
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
  },
  {
    id: "snap-shot-sound",
    title: "Capture sound",
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
  },
  {
    id: "snap-shot-flash",
    title: "Capture flash",
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
  },
  {
    id: "snap-shot-animations",
    title: "Capture animations",
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
  },
  {
    id: "providers",
    title: "Providers",
    to: "/settings/providers",
    searchTerms: [
      "agents cli codex claude cursor grok opencode antigravity google sign in sign out install subscription instances authentication api key models configuration binary path config directory endpoint arguments environment variables display name accent color custom favorite hidden auto compact",
    ],
  },
  {
    id: "usage-providers",
    title: "Usage providers",
    to: "/settings/providers",
    searchTerms: [
      "usage sources CLIProxyAPI CLI proxy hub quota subscription limits management key add remove",
    ],
    providerSettingsOnly: true,
  },
  {
    id: "cursor-keychain-usage",
    title: "Cursor account usage",
    to: "/settings/providers",
    searchTerms: ["cursor macOS keychain usage tokens cost limits permission"],
    providerSettingsOnly: true,
    macProviderSettingsOnly: true,
  },
  {
    id: "provider-health-check-interval",
    title: "Health check interval",
    to: "/settings/providers",
    searchTerms: ["refresh availability versions auth state models background probes seconds off"],
    providerSettingsOnly: true,
  },
  {
    id: "agent-browser-access",
    title: "Agent browser access",
    to: "/settings/integrations",
    scope: "project-defaults",
    searchTerms: ["allow disable enable open drive preview tools sessions project override"],
  },
  {
    id: "device-hosts",
    title: "Device hosts",
    to: "/settings/integrations",
    searchTerms: ["ssh remote simulator emulator ios android mac mini identity key connection"],
  },
  {
    id: "agent-device-access",
    title: "Agent device access",
    to: "/settings/integrations",
    targetId: "devices",
    searchTerms: ["allow simulator emulator ios android drive tools sessions"],
  },
  {
    id: "device-hub",
    title: "Device hub",
    to: "/settings/integrations",
    targetId: "devices",
    searchTerms: ["simulator emulator ios android install start"],
  },
  {
    id: "device-platform-support",
    title: "Simulator support",
    to: "/settings/integrations",
    targetId: "devices",
    searchTerms: ["xcode android studio sdk avd runtime"],
  },
  {
    id: "browser-profiles",
    title: "Browser profiles",
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-default-profile",
    title: "Default browser profile",
    to: "/settings/integrations",
    targetId: "browser-profiles",
  },
  {
    id: "browser-default-viewport",
    title: "Default browser viewport",
    to: "/settings/integrations",
    searchTerms: ["preview size width height device desktop mobile rotate"],
  },
  {
    id: "browser-default-zoom",
    title: "Default browser zoom",
    to: "/settings/integrations",
    searchTerms: ["preview page scale tabs percent"],
  },
  {
    id: "browser-default-appearance",
    title: "Default browser appearance",
    to: "/settings/integrations",
    searchTerms: ["preview color scheme light dark system os"],
  },
  {
    id: "browser-recording-frame-rate",
    title: "Browser recording frame rate",
    to: "/settings/integrations",
  },
  {
    id: "browser-recording-key-presses",
    title: "Show key presses in recordings",
    to: "/settings/integrations",
    searchTerms: ["browser preview keyboard shortcuts keystrokes overlay capture"],
  },
  {
    id: "browser-recording-mouse-presses",
    title: "Show mouse presses in recordings",
    to: "/settings/integrations",
    searchTerms: ["browser preview clicks buttons drag overlay capture"],
  },
  {
    id: "browser-link-target",
    title: "Open links in",
    to: "/settings/integrations",
    searchTerms: ["links default browser in-app browser external open"],
  },
  {
    id: "browser-search-engine",
    title: "Search engine",
    to: "/settings/integrations",
    searchTerms: ["address bar duckduckgo google bing brave kagi ecosia custom"],
  },
  {
    id: "pull-request-links-open-in-app",
    title: "Open pull requests in T3 Code",
    to: "/settings/integrations",
    searchTerms: [
      `pr links ${SOURCE_CONTROL_HOST_LABELS} browser external click default pull request view panel`,
    ],
  },
  {
    id: "browser-auto-show-floating-preview",
    title: "Auto-show floating preview",
    to: "/settings/integrations",
    searchTerms: ["agent opens browser device simulator pop into view hide"],
  },
  {
    id: "automatic-pull",
    title: "Automatically pull",
    to: "/settings/source-control",
    scope: "project-defaults",
    searchTerms: ["auto pull default branch current checkout fast forward upstream"],
  },
  {
    id: "remove-agent-credits-on-merge",
    title: "Remove agent credits when merging",
    to: "/settings/source-control",
    scope: "project-defaults",
    searchTerms: [
      `pull request ${SOURCE_CONTROL_HOST_LABELS} squash co-authored-by attribution claude codex generated`,
    ],
  },
  {
    id: "pull-request-merge-method",
    title: "Default merge method",
    to: "/settings/source-control",
    scope: "project-defaults",
    searchTerms: ["pull request merge squash rebase last selected"],
  },
  {
    id: "source-control",
    title: "Source control",
    to: "/settings/source-control",
    scope: "environment-defaults",
    searchTerms: [
      `version control git ${SOURCE_CONTROL_HOST_TERMS} hosting integrations credentials scan server environment`,
    ],
  },
  {
    id: "git-fetch-interval",
    title: "Git fetch interval",
    to: "/settings/source-control",
    searchTerms: [
      "automatic remote branch refresh background credentials security keys seconds off",
    ],
    environmentOnly: true,
    scope: "environment-defaults",
  },
  {
    id: "worktree-branch-naming",
    title: "Worktree branch naming",
    to: "/settings/source-control",
    searchTerms: ["static semantic prefix custom prompt instructions feat fix refactor chore"],
    environmentOnly: true,
    scope: "project-defaults",
  },
  ...sourceControlHostSearchItems(sourceControlClients.definitions),
  {
    id: "source-control-writing-style",
    title: "Source control writing style",
    to: "/settings/source-control",
    searchTerms: [
      "repository conventions conventional commits custom instructions change descriptions request titles",
    ],
    environmentOnly: true,
  },
  {
    id: "follow-change-request-templates",
    title: "Follow change request templates",
    to: "/settings/source-control",
    searchTerms: ["repository pr pull request description structure"],
    environmentOnly: true,
  },
  {
    id: "source-control-writer-model",
    title: "Source control writer model",
    to: "/settings/source-control",
    searchTerms: [
      "override generated commit change request pr titles descriptions branch bookmark",
    ],
    environmentOnly: true,
    scope: "project-defaults",
  },
  {
    id: "review-guides",
    title: "Review guides (beta)",
    to: "/settings/source-control",
    searchTerms: ["pull request pr guided review guide tour beta experimental"],
    environmentOnly: true,
  },
  {
    id: "review-guide-model",
    title: "Review guide model",
    to: "/settings/source-control",
    // Hidden until review guides are on, so a search lands on the switch that shows it.
    targetId: "review-guides",
    searchTerms: ["pull request pr guided review guide brief maintainer"],
    environmentOnly: true,
    scope: "project-defaults",
  },
  {
    id: "review-guide-instructions",
    title: "Review guide instructions",
    to: "/settings/source-control",
    targetId: "review-guides",
    searchTerms: ["pull request pr guided review guide preferences taste prompt custom"],
    environmentOnly: true,
    scope: "project-defaults",
  },
  {
    id: "project-actions",
    title: "Actions",
    to: "/settings/projects",
    searchTerms: ["commands scripts setup run dev server checkout worktree t3.json import"],
  },
  {
    id: "environment-icon",
    title: "Environment icon",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: ["machine glyph sidebar mac mini studio laptop desktop server cloud vm"],
  },
  {
    id: "local-environment",
    title: "Local environment",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: ["turn off on disable enable local server agents remote only restart"],
    desktopOnly: true,
  },
  {
    id: "network-access",
    title: "Network access",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: ["expose backend remote pairing local machine interfaces host restart"],
    localBackendManagementOnly: true,
  },
  {
    id: "tailscale-https",
    title: "Tailscale HTTPS",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: ["serve magicdns endpoint remote secure network"],
    desktopOnly: true,
    localBackendManagementOnly: true,
  },
  {
    id: "wsl-backend",
    title: "WSL backend",
    to: "/settings/connections",
    searchTerms: [
      "windows subsystem linux distro second server projects stop windows backend restart",
    ],
    desktopOnly: true,
    windowsOnly: true,
    localBackendManagementOnly: true,
    wslAvailableOnly: true,
  },
  {
    id: "t3-connect",
    localEnvironmentOnly: true,
    title: "T3 Connect",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: ["managed tunnel cloud other devices remote"],
    desktopOnly: true,
    cloudOnly: true,
  },
  {
    id: "hold-webhooks-while-offline",
    localEnvironmentOnly: true,
    title: "Hold webhooks while offline",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: ["webhook automations offline queue mailbox t3 connect"],
    cloudOnly: true,
    managedTunnelOnly: true,
  },
  {
    id: "publish-agent-activity",
    localEnvironmentOnly: true,
    title: "Publish agent activity",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: ["mobile push notifications live activities cloud tunnel"],
    cloudOnly: true,
  },
  {
    id: "connections-environment",
    title: "This machine",
    to: "/settings/connections",
    searchTerms: [
      "connections server backend local remote access administrative permissions scope pairing links qr code authorized clients sessions revoke endpoint",
    ],
  },
  {
    id: "remote-environments",
    title: "Environments",
    to: "/settings/connections",
    searchTerms: ["add pair backend host code ssh config agent tunnel saved t3 connect"],
  },
  {
    id: "load-balancing",
    title: "Load balancing",
    to: "/settings/connections",
    searchTerms: [
      "automatic machine environment resources cpu memory capacity preference weight shared projects",
    ],
  },
  {
    id: "pull-request-routing",
    title: "Pull request sharing",
    to: "/settings/connections",
    searchTerms: [
      `pull request routing trusted environments shared credentials permissions read actions source control ${SOURCE_CONTROL_HOST_LABELS}`,
    ],
  },
  {
    id: "archive",
    title: "Archived threads",
    to: "/settings/archived",
    searchTerms: ["restore reopen deleted history projects"],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;

export type SettingsSearchItemId = (typeof SETTINGS_SEARCH_ITEMS)[number]["id"];

const SEARCH_ITEMS_BY_ID = new Map(SETTINGS_SEARCH_ITEMS.map((item) => [item.id, item] as const));

/**
 * Simplified Chinese overlay for registry titles, keyed by item id. The registry itself stays
 * English so search tests and English search keep working; localization happens on render paths
 * (searchableSetting / localizeAvailableSettingsSearchItems). `terms` are extra Chinese search
 * keywords appended to the item's English terms.
 */
const SETTINGS_SEARCH_ITEMS_ZH: Readonly<Record<string, { title: string; terms?: string }>> = {
  "storage-worktree-keep-when": { title: "保留含本地更改的工作树" },
  "storage-delete-now": { title: "立即清理", terms: "马上 运行 清理报告" },
  "storage-worktrees": { title: "工作树清理", terms: "磁盘 清理 归档 会话 保留天数" },
  "storage-worktrees-location": { title: "工作树位置", terms: "目录 路径 外置磁盘" },
  "storage-artifacts": { title: "产物与日志", terms: "磁盘 截图 日志 清理 保留" },
  "project-defaults": { title: "项目默认值与覆盖", terms: "继承 检出 环境" },
  "project-overview": { title: "项目概览", terms: "名称 图标 删除 移除" },
  "default-model": { title: "默认模型", terms: "新会话 提供商 推理强度" },
  "default-permissions": { title: "权限", terms: "运行模式 监督 审批 自动接受编辑 完全访问" },
  "color-scheme": { title: "配色方案", terms: "深色 浅色 跟随系统 外观模式" },
  theme: { title: "主题", terms: "配色 自定义 导入" },
  "setting-appearance-contrast": { title: "对比度", terms: "颜色 边框 界面" },
  "setting-glass-opacity": { title: "毛玻璃不透明度", terms: "透明 模糊 菜单 对话框" },
  "diff-color-scheme": { title: "Diff 配色", terms: "红绿 蓝橙 新增 删除 色盲" },
  "chat-width": { title: "对话宽度", terms: "宽 全宽 栏宽 布局" },
  "math-rendering": { title: "数学公式渲染", terms: "LaTeX KaTeX 公式" },
  "panel-animations": { title: "面板动画", terms: "过渡 动效" },
  "environment-identification": { title: "环境标识", terms: "徽标 标签 隐藏" },
  "interface-font": { title: "界面字体", terms: "字体 字号 无衬线" },
  "prompt-font": { title: "输入框字体", terms: "字体 字号 提示词" },
  "code-font": { title: "代码字体", terms: "等宽 代码块 Diff 文件预览" },
  "terminal-font": { title: "终端字体", terms: "等宽 输出" },
  "font-smoothing": { title: "字体平滑", terms: "灰度 抗锯齿" },
  "word-wrap": { title: "自动换行", terms: "长行 代码块 表格 文件预览" },
  "composer-context": { title: "输入框上下文", terms: "引用 附件" },
  "project-grouping": { title: "项目分组", terms: "合并 仓库 侧边栏" },
  "project-order": { title: "项目排序", terms: "手动 创建时间 最近使用" },
  "snooze-limited-threads": { title: "暂停至用量重置", terms: "配额 限流 恢复" },
  "auto-resume-limited-threads": { title: "用量重置后自动恢复", terms: "配额 限流 继续" },
  "new-design": { title: "新设计", terms: "Beta 改版 侧边栏 输入框" },
  "working-shelf": { title: "进行中区", terms: "Beta 折叠 运行中 收件箱" },
  "guest-links": { title: "访客链接", terms: "分享 邀请 只读 观察" },
  "auto-settle-inactive-threads": { title: "自动收起不活跃会话", terms: "闲置 天数 自动" },
  "compact-idle-threads": { title: "压缩空闲会话上下文", terms: "上下文压缩 缓存 token 摘要" },
  "auto-settle-merged-threads": { title: "自动收起已合并会话", terms: "Pull Request 合并 关闭" },
  "days-before-auto-settle": { title: "自动收起前的闲置天数", terms: "超时 不活跃" },
  "thread-notifications": { title: "会话通知", terms: "声音 提醒 完成 输入 审批" },
  "in-app-notifications": { title: "应用内通知", terms: "弹窗 完成 失败 审批" },
  "time-format": { title: "时间格式", terms: "时间戳 12 小时 24 小时 跟随系统" },
  "response-streaming": { title: "响应流式输出", terms: "逐段输出 等待整段 回合" },
  "hide-whitespace-changes": { title: "隐藏空白更改", terms: "Diff 空格 缩进" },
  "default-diff-file-state": { title: "Diff 文件默认状态", terms: "折叠 展开" },
  "diff-layout": { title: "Diff 布局", terms: "堆叠 分栏 并排 统一" },
  "proactive-panels": { title: "主动打开面板", terms: "自动打开 Diff Pull Request 右侧面板" },
  "skills-in-slash-menu": { title: "在斜杠菜单中显示技能", terms: "命令菜单 $ /" },
  "composer-rich-text": { title: "富文本输入框", terms: "加粗 斜体 Markdown 所见即所得" },
  "composer-collapse": { title: "滚动时收起输入框", terms: "滚动 收起 缩小" },
  "send-shortcut": { title: "发送快捷键", terms: "Enter 回车 换行 多行" },
  "follow-up-behavior": { title: "追加消息行为", terms: "排队 插入 运行中 默认" },
  "provider-update-checks": { title: "提供商更新检查", terms: "CLI 版本 检查更新" },
  "continue-threads-after-server-update": {
    title: "重启后继续会话",
    terms: "恢复运行 中断 崩溃 自动",
  },
  "background-activity": { title: "后台活动", terms: "性能 省电 Git 拉取 刷新 策略" },
  "new-threads": { title: "新会话", terms: "工作区 草稿 本地 工作树" },
  "worktree-submodules": { title: "子模块", terms: "git submodule 递归" },
  "start-from-origin": { title: "从远程起点开始", terms: "远程 最新 分支 本地" },
  "add-project-starts-in": { title: "添加项目的起始位置", terms: "基础目录 路径 主目录" },
  "unpin-confirmation": { title: "取消置顶确认", terms: "再次点击 确认" },
  "archive-confirmation": { title: "归档确认", terms: "再次点击 确认" },
  "delete-confirmation": { title: "删除确认", terms: "历史记录 确认" },
  "quit-confirmation": { title: "退出确认", terms: "长按 双击 退出应用" },
  "text-generation-model": { title: "文本生成模型", terms: "会话标题 生成 提供商" },
  "thread-title-instructions": { title: "会话标题生成指令", terms: "标题 提示词 风格 重命名" },
  "app-version": { title: "版本", terms: "关于 检查更新 下载 安装 升级" },
  "update-track": { title: "更新通道", terms: "稳定版 最新版 Nightly 预发布" },
  "cli-command": { title: "t3 命令", terms: "CLI 终端 命令行 安装" },
  "mobile-app": { title: "移动应用", terms: "手机 平板 iOS Android 二维码" },
  "privacy-policy": { title: "隐私政策", terms: "遥测 分析 数据 退出" },
  "telemetry-export": { title: "OpenTelemetry 导出", terms: "OTel OTLP 日志 追踪 指标" },
  diagnostics: { title: "诊断", terms: "日志 追踪 进程 资源 历史 CPU 内存" },
  "open-source-licenses": { title: "开源许可", terms: "许可证 第三方" },
  "legacy-plan-mode": { title: "计划模式（旧版）", terms: "旧版 兼容" },
  "legacy-context-window-indicator": { title: "上下文窗口指示器（旧版）", terms: "用量 圆环 旧版" },
  "legacy-sidebar": { title: "侧边栏（旧版）", terms: "树形 列表 旧版" },
  keybindings: { title: "快捷键", terms: "键盘 快捷方式 命令 绑定 JSON" },
  "snap-shot-enabled": { title: "SnapShot", terms: "窗口 截图 屏幕捕获" },
  "snap-shot-accessibility": { title: "包含应用文本", terms: "无障碍 UI 结构 隐私 上下文" },
  "snap-shot-shortcut": { title: "截取快捷键", terms: "快捷键 触发" },
  "snap-shot-sound": { title: "截取音效", terms: "声音 提示音" },
  "snap-shot-flash": { title: "截取闪光", terms: "闪光效果" },
  "snap-shot-animations": { title: "截取动画", terms: "动画效果" },
  providers: { title: "提供商", terms: "Agent CLI 登录 安装 订阅 实例 认证 API Key 模型 配置" },
  "usage-providers": { title: "用量数据源", terms: "配额 订阅 限额 密钥" },
  "cursor-keychain-usage": { title: "Cursor 账户用量", terms: "钥匙串 用量 费用 限额" },
  "provider-health-check-interval": { title: "健康检查间隔", terms: "刷新 可用性 后台探测" },
  "agent-browser-access": { title: "Agent 浏览器访问", terms: "允许 预览 工具 会话 覆盖" },
  "device-hosts": { title: "设备主机", terms: "SSH 远程 模拟器 iOS Android 连接" },
  "agent-device-access": { title: "Agent 设备访问", terms: "允许 模拟器 工具 会话" },
  "device-hub": { title: "设备中心", terms: "模拟器 安装 启动" },
  "device-platform-support": { title: "模拟器支持", terms: "Xcode Android Studio SDK" },
  "browser-profiles": { title: "浏览器配置", terms: "Profile 多配置" },
  "browser-default-profile": { title: "默认浏览器配置", terms: "Profile 默认" },
  "browser-default-viewport": { title: "默认浏览器视口", terms: "尺寸 宽高 设备 旋转" },
  "browser-default-zoom": { title: "默认浏览器缩放", terms: "缩放 比例 页面" },
  "browser-default-appearance": { title: "默认浏览器外观", terms: "深色 浅色 跟随系统" },
  "browser-recording-frame-rate": { title: "浏览器录制帧率", terms: "录制 帧率 FPS" },
  "browser-recording-key-presses": { title: "录制中显示按键", terms: "键盘 按键 覆盖层" },
  "browser-recording-mouse-presses": { title: "录制中显示鼠标点击", terms: "点击 拖拽 覆盖层" },
  "browser-link-target": { title: "链接打开方式", terms: "外部浏览器 应用内打开 默认" },
  "browser-search-engine": { title: "搜索引擎", terms: "地址栏 Google Bing DuckDuckGo 自定义" },
  "pull-request-links-open-in-app": {
    title: "在 T3 Code 中打开 Pull Request",
    terms: "PR 链接 浏览器 外部 默认",
  },
  "browser-auto-show-floating-preview": {
    title: "自动弹出浮动预览",
    terms: "浮动窗口 预览 隐藏",
  },
  "automatic-pull": { title: "自动拉取", terms: "默认分支 快进 上游" },
  "remove-agent-credits-on-merge": {
    title: "合并时移除 AI 署名",
    terms: "Co-authored-by 署名 归属 压缩合并",
  },
  "pull-request-merge-method": { title: "默认合并方式", terms: "合并 压缩合并 变基 上次选择" },
  "source-control": { title: "版本控制", terms: "Git 托管 集成 凭据 扫描" },
  "git-fetch-interval": { title: "Git 拉取间隔", terms: "远程 分支 刷新 凭据 秒 关闭" },
  "worktree-branch-naming": {
    title: "工作树分支命名",
    terms: "语义 前缀 自定义 提示词 feat fix",
  },
  "source-control-writing-style": {
    title: "版本控制写作风格",
    terms: "约定式提交 自定义指令 变更描述 标题",
  },
  "follow-change-request-templates": { title: "遵循变更请求模板", terms: "模板 描述 结构" },
  "source-control-writer-model": {
    title: "版本控制写作模型",
    terms: "覆盖 生成 提交 标题 描述 分支",
  },
  "review-guides": { title: "评审向导（Beta）", terms: "引导式评审 实验性" },
  "review-guide-model": { title: "评审向导模型", terms: "覆盖 生成 评审摘要" },
  "review-guide-instructions": { title: "评审向导指令", terms: "偏好 提示词 自定义" },
  "project-actions": { title: "动作", terms: "命令 脚本 启动 开发服务器 检出" },
  "environment-icon": { title: "环境图标", terms: "机器 图标 侧边栏 服务器 云" },
  "local-environment": { title: "本地环境", terms: "开关 禁用 启用 本地服务器 重启" },
  "network-access": { title: "网络访问", terms: "暴露 后端 远程 配对 接口 重启" },
  "tailscale-https": { title: "Tailscale HTTPS", terms: "安全 端点 远程" },
  "wsl-backend": { title: "WSL 后端", terms: "Windows 子系统 发行版 重启" },
  "t3-connect": { title: "T3 Connect", terms: "隧道 云 远程 其他设备" },
  "hold-webhooks-while-offline": { title: "离线时暂存 Webhook", terms: "自动化 队列 离线" },
  "publish-agent-activity": { title: "发布 Agent 动态", terms: "推送通知 实时活动 云" },
  "connections-environment": {
    title: "本机",
    terms: "连接 服务器 本地 远程 权限 配对 二维码 授权客户端 会话 吊销",
  },
  "remote-environments": { title: "环境", terms: "添加 配对 主机 SSH 隧道 保存" },
  "load-balancing": { title: "负载均衡", terms: "自动 资源 CPU 内存 权重 共享" },
  "pull-request-routing": {
    title: "Pull Request 共享",
    terms: "路由 信任环境 凭据 权限",
  },
  archive: { title: "已归档会话", terms: "恢复 重新打开 历史" },
};

function localizeSearchTitle(id: string, fallback: string): string {
  if (i18next.language !== "zh-CN") return fallback;
  return SETTINGS_SEARCH_ITEMS_ZH[id]?.title ?? fallback;
}

/**
 * Localizes a filtered search-item list for the nav search and command palette. English terms are
 * kept so searches in either language still match. Pure render-path helper: not used by searchSettings.
 */
export function localizeAvailableSettingsSearchItems(
  items: ReadonlyArray<SettingsSearchItem>,
): ReadonlyArray<SettingsSearchItem> {
  if (i18next.language !== "zh-CN") return items;
  return items.map((item) => {
    const zh = SETTINGS_SEARCH_ITEMS_ZH[item.id];
    if (!zh) return item;
    return {
      ...item,
      title: zh.title,
      ...(zh.terms ? { searchTerms: [...(item.searchTerms ?? []), zh.terms] } : {}),
    };
  });
}

const SETTINGS_CATEGORY_SCOPES: Readonly<Record<SettingsPath, SettingsSearchScope | null>> = {
  "/settings/diagnostics": "environment",
  "/settings/projects": "project",
  "/settings/general": null,
  "/settings/appearance": null,
  "/settings/snap-shot": null,
  "/settings/keybindings": null,
  "/settings/providers": null,
  "/settings/integrations": null,
  "/settings/source-control": "environment-defaults",
  "/settings/storage": "project-defaults",
  "/settings/connections": "connections",
  "/settings/scheduled-tasks": null,
  "/settings/beta": null,
  "/settings/archived": "project-defaults",
};

export function getSettingsSearchTargetScope(targetId: string) {
  const items: readonly SettingsSearchItem[] = SETTINGS_SEARCH_ITEMS;
  const item =
    items.find((candidate) => candidate.id === targetId) ??
    items.find((candidate) => candidate.targetId === targetId);
  return item
    ? {
        title: item.title,
        scope: item.scope ?? SETTINGS_CATEGORY_SCOPES[item.to],
        ...(item.requiresThreadAutoSettlement ? { requiresThreadAutoSettlement: true } : {}),
      }
    : null;
}

interface AutoSettlementSearchEnvironment {
  readonly environmentId: EnvironmentId;
  readonly connection: { readonly phase: EnvironmentConnectionPhase };
  readonly serverConfig: {
    readonly environment: {
      readonly capabilities: { readonly threadAutoSettlement?: boolean };
    };
  } | null;
}

export function getThreadAutoSettlementSearchAvailability(
  environments: readonly AutoSettlementSearchEnvironment[],
  scope?: Pick<ResolvedSettingsScope, "kind" | "environmentIds">,
) {
  const connected = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" && environment.serverConfig !== null,
  );
  const eligibleEnvironmentIds = connected
    .filter(
      (environment) =>
        environment.serverConfig?.environment.capabilities.threadAutoSettlement === true,
    )
    .map((environment) => environment.environmentId);
  const selected = connected.filter((environment) =>
    scope?.environmentIds.includes(environment.environmentId),
  );
  return {
    eligibleEnvironmentIds,
    isTargetAvailable:
      scope !== undefined &&
      scope.kind !== "unavailable" &&
      selected.length > 0 &&
      selected.every((environment) => eligibleEnvironmentIds.includes(environment.environmentId)),
  };
}

export function isSettingsSearchScopeAvailable(
  requiredScope: SettingsSearchScope | null,
  scopeKind: ResolvedSettingsScope["kind"],
): boolean {
  switch (requiredScope) {
    case null:
    case "connections":
      return true;
    case "environment":
    case "checkout":
      return requiredScope === scopeKind;
    case "project":
      return scopeKind === "project" || scopeKind === "checkout";
    case "environment-defaults":
      return scopeKind === "environment" || scopeKind === "all";
    case "project-defaults":
      return (
        scopeKind === "environment" ||
        scopeKind === "all" ||
        scopeKind === "project" ||
        scopeKind === "checkout"
      );
  }
}

function settingsScopeKindFromSearch(search: SettingsScopeSearch): ResolvedSettingsScope["kind"] {
  const target = validateSettingsScopeSearch({ ...search });
  if (target.checkout && !target.project) return "unavailable";
  if (target.project) return target.checkout ? "checkout" : "project";
  return target.machine ? "environment" : "all";
}

export function isSettingsOverviewVisible(search: SettingsScopeSearch): boolean {
  const kind = settingsScopeKindFromSearch(search);
  return kind === "project" || kind === "checkout";
}

export function searchableSetting(id: SettingsSearchItemId): {
  readonly id: string;
  readonly title: string;
} {
  const { id: anchorId, title } = SEARCH_ITEMS_BY_ID.get(id)!;
  return { id: anchorId, title: localizeSearchTitle(id, title) };
}

export function filterAvailableSettingsSearchItems(
  availability: SettingsSearchAvailability,
): ReadonlyArray<SettingsSearchItem> {
  const items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS;
  return items.filter(
    (item) =>
      (!item.cloudOnly || availability.hasCloudPublicConfig) &&
      (!item.environmentOnly || availability.hasEnvironment) &&
      (!item.providerSettingsOnly || availability.hasProviderSettingsEnvironment) &&
      (!item.macProviderSettingsOnly || availability.hasMacProviderSettingsEnvironment) &&
      (!item.localBackendManagementOnly || availability.canManageLocalBackend) &&
      (!item.localEnvironmentOnly || !availability.localEnvironmentDisabled) &&
      (!item.wslAvailableOnly || availability.isWslSettingsRowVisible) &&
      (!item.requiresThreadAutoSettlement || availability.hasThreadAutoSettlement) &&
      (!item.managedTunnelOnly || availability.managedTunnelActive === true),
  );
}

/** The settings that exist on this platform and app channel. */
export function settingsForThisPlatform(
  items: ReadonlyArray<SettingsSearchItem>,
): ReadonlyArray<SettingsSearchItem> {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  return items.filter(
    (item) =>
      (isElectron || item.desktopOnly !== true) &&
      (!item.releaseChannelOnly || isElectron || HOSTED_APP_CHANNEL !== null) &&
      (!item.macOnly || isMacPlatform(platform)) &&
      (!item.windowsOnly || isWindowsPlatform(platform)),
  );
}

export function searchSettings(
  query: string,
  items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS,
): ReadonlyArray<SettingsSearchItem> {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return [];
  const queryTokens = normalizedQuery.split(" ");

  return settingsForThisPlatform(items)
    .flatMap((item, index) => {
      const title = normalizeSearchText(item.title);
      const fields = [
        title,
        normalizeSearchText(SETTINGS_SECTION_LABELS[item.to]),
        ...(item.searchTerms ?? []).map(normalizeSearchText),
      ];
      if (!queryTokens.every((token) => fields.some((field) => field.includes(token)))) return [];

      const exactPhraseField = fields.findIndex((field) => field.includes(normalizedQuery));
      const rank =
        title === normalizedQuery
          ? 5
          : title.startsWith(normalizedQuery)
            ? 4
            : title.includes(normalizedQuery)
              ? 3
              : queryTokens.every((token) => title.includes(token))
                ? 2
                : exactPhraseField >= 0
                  ? 1
                  : 0;
      return [{ item, index, rank }];
    })
    .toSorted(
      (left, right) =>
        Number(left.item.secondary ?? false) - Number(right.item.secondary ?? false) ||
        right.rank - left.rank ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}

// Font smoothing only renders on macOS, so a search jump to it elsewhere
// must not flip the section - the target would never mount to be scrolled to.
const ADVANCED_TYPOGRAPHY_TARGET_IDS: ReadonlySet<string> = new Set([
  "prompt-font",
  "terminal-font",
  ...(typeof navigator !== "undefined" && isMacPlatform(navigator.platform)
    ? ["font-smoothing"]
    : []),
]);

export function isAdvancedTypographyTarget(targetId: string): boolean {
  return ADVANCED_TYPOGRAPHY_TARGET_IDS.has(targetId);
}

/**
 * Opens the persisted section a search result lives in before jumping to it, so
 * its row is mounted to scroll to. The terminal reads the same flag, so it must
 * stay on after the jump.
 */
export function revealSettingsSearchTarget(targetId: string): void {
  if (isAdvancedTypographyTarget(targetId)) {
    writeLocalStorageValue(TYPOGRAPHY_ADVANCED_STORAGE_KEY, true, false, Schema.Boolean);
  }
}
