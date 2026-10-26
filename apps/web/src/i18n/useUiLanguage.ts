import { useTranslation } from "react-i18next";

import type { UiLanguage } from "@t3tools/contracts/settings";

import { updateClientSettings, useClientSettings } from "../hooks/useSettings";
import { APP_LANGUAGES, resolveLanguage, type AppLanguage } from "./index";

/** Native labels are shown in their own language regardless of the active UI language. */
export const UI_LANGUAGE_NATIVE_LABELS: Readonly<Record<AppLanguage, string>> = {
  en: "English",
  "zh-CN": "简体中文",
};

/** Select options for the language picker; the "system" label is translated, languages are not. */
export function uiLanguageOptions(
  systemLabel: string,
): ReadonlyArray<{ value: UiLanguage; label: string }> {
  return [
    { value: "system", label: systemLabel },
    ...APP_LANGUAGES.map((language) => ({
      value: language,
      label: UI_LANGUAGE_NATIVE_LABELS[language],
    })),
  ];
}

export interface UiLanguageState {
  /** Persisted preference, including the "system" sentinel. */
  readonly uiLanguage: UiLanguage;
  /** Concrete language i18next is rendering in. */
  readonly language: AppLanguage;
  readonly setUiLanguage: (value: UiLanguage) => void;
}

export function useUiLanguage(): UiLanguageState {
  const { i18n } = useTranslation();
  const uiLanguage = useClientSettings((settings) => settings.uiLanguage);
  const language = resolveLanguage(uiLanguage);
  const setUiLanguage = (value: UiLanguage) => {
    void updateClientSettings({ uiLanguage: value });
  };
  return {
    uiLanguage,
    language: APP_LANGUAGES.includes(i18n.language as AppLanguage)
      ? (i18n.language as AppLanguage)
      : language,
    setUiLanguage,
  };
}
