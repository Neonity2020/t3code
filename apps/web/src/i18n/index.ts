import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import enBase from "./locales/base.en.json";
import enConnections from "./locales/connections.en.json";
import enIntegrations from "./locales/integrations.en.json";
import enAppearance from "./locales/appearance.en.json";
import enKeybindings from "./locales/keybindings.en.json";
import enNotifications from "./locales/notifications.en.json";
import enSnapshot from "./locales/snapshot.en.json";
import enStorage from "./locales/storage.en.json";
import zhBase from "./locales/base.zh-CN.json";
import zhConnections from "./locales/connections.zh-CN.json";
import zhIntegrations from "./locales/integrations.zh-CN.json";
import zhAppearance from "./locales/appearance.zh-CN.json";
import zhKeybindings from "./locales/keybindings.zh-CN.json";
import zhNotifications from "./locales/notifications.zh-CN.json";
import zhSnapshot from "./locales/snapshot.zh-CN.json";
import zhStorage from "./locales/storage.zh-CN.json";

// Fragment files must use disjoint top-level namespaces so a shallow spread merges them.
const en = {
  ...enBase,
  ...enAppearance,
  ...enConnections,
  ...enIntegrations,
  ...enKeybindings,
  ...enNotifications,
  ...enSnapshot,
  ...enStorage,
};
const zhCn = {
  ...zhBase,
  ...zhAppearance,
  ...zhConnections,
  ...zhIntegrations,
  ...zhKeybindings,
  ...zhNotifications,
  ...zhSnapshot,
  ...zhStorage,
};

export const APP_LANGUAGES = ["en", "zh-CN"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

/** Mirror of the persisted uiLanguage setting for the synchronous boot path (avoids a language flash). */
const LANGUAGE_STORAGE_KEY = "t3.ui-language";

function resolveSystemLanguage(): AppLanguage {
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

/** Resolves a persisted UiLanguage value ("system" | "en" | "zh-CN") to a concrete app language. */
export function resolveLanguage(uiLanguage: string): AppLanguage {
  if (uiLanguage === "en" || uiLanguage === "zh-CN") return uiLanguage;
  return resolveSystemLanguage();
}

function readStoredLanguage(): AppLanguage | null {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored === "en" || stored === "zh-CN" ? stored : null;
  } catch {
    return null;
  }
}

/** Called by the appInit language service; mirrors the value for the next synchronous boot. */
export function changeUiLanguage(language: AppLanguage): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Storage may be unavailable (private mode); the persisted setting stays authoritative.
  }
  void i18next.changeLanguage(language);
}

void i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCn },
  },
  lng: readStoredLanguage() ?? resolveSystemLanguage(),
  fallbackLng: "en",
  supportedLngs: [...APP_LANGUAGES],
  interpolation: {
    // React already escapes rendered text.
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
});

/** Section labels for SettingsPath values are keyed as `settings.sections.<path-segment>`. */
export function settingsSectionKey(path: string): string {
  return `settings.sections.${path.slice("/settings/".length)}`;
}

export default i18next;
