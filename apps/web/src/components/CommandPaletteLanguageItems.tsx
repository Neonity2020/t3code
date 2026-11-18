import { nativeLanguageName, SYSTEM_LANGUAGE } from "@t3tools/client-runtime/locales";
import { useGT } from "gt-react";
import { GlobeIcon, LanguagesIcon } from "lucide-react";

import { updateClientSettings, useClientSettings } from "../hooks/useSettings";
import { SUPPORTED_LOCALES } from "../i18n/locales";
import {
  ADDON_ICON_CLASS,
  ITEM_ICON_CLASS,
  type CommandPaletteSubmenuItem,
} from "./CommandPalette.logic";
import { stackedThreadToast, toastManager } from "./ui/toast";

const LOCALE_SEARCH_TERMS: Readonly<Record<string, ReadonlyArray<string>>> = {
  en: ["english", "en", "英文", "英语"],
  zh: ["chinese", "zh", "zh-cn", "中文", "简体中文", "汉语"],
  de: ["german", "deutsch", "de", "德语"],
  es: ["spanish", "español", "es", "西班牙语"],
  fr: ["french", "français", "fr", "法语"],
  ja: ["japanese", "日本語", "ja", "日语"],
  ko: ["korean", "한국어", "ko", "韩语"],
  "pt-BR": ["portuguese", "português", "pt-br", "葡萄牙语"],
  ru: ["russian", "русский", "ru", "俄语"],
};

export function useCommandPaletteLanguageItems() {
  const gt = useGT();
  const language = useClientSettings((settings) => settings.language);
  const currentLanguage = SUPPORTED_LOCALES.includes(language) ? language : SYSTEM_LANGUAGE;

  const setLanguage = async (nextLanguage: string) => {
    try {
      await updateClientSettings({ language: nextLanguage });
    } catch {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Couldn't save language selection"),
          description: gt("Try again."),
        }),
      );
    }
  };

  const changeLanguageItem: CommandPaletteSubmenuItem = {
    kind: "submenu",
    value: "action:change-language",
    searchTerms: [
      "change language",
      "language",
      "locale",
      "i18n",
      "english",
      "chinese",
      "切换语言",
      "语言",
      "中文",
      "英文",
    ],
    title: gt("Change language"),
    icon: <LanguagesIcon className={ITEM_ICON_CLASS} />,
    addonIcon: <LanguagesIcon className={ADDON_ICON_CLASS} />,
    groups: [
      {
        value: "languages",
        label: gt("Change language"),
        items: [
          {
            kind: "action",
            value: `language:${SYSTEM_LANGUAGE}`,
            title: gt("System default"),
            searchTerms: ["system", "default", "auto", "系统默认", "跟随系统", "语言"],
            icon: <GlobeIcon className={ITEM_ICON_CLASS} />,
            titleTrailingContent:
              currentLanguage === SYSTEM_LANGUAGE ? (
                <span className="text-xs text-muted-foreground/70">{gt("Current")}</span>
              ) : undefined,
            run: () => setLanguage(SYSTEM_LANGUAGE),
          },
          ...SUPPORTED_LOCALES.map((locale) => {
            const label = nativeLanguageName(locale);
            return {
              kind: "action" as const,
              value: `language:${locale}`,
              title: label,
              searchTerms: [label, locale, "language", ...(LOCALE_SEARCH_TERMS[locale] ?? [])],
              icon: <LanguagesIcon className={ITEM_ICON_CLASS} />,
              titleTrailingContent:
                currentLanguage === locale ? (
                  <span className="text-xs text-muted-foreground/70">{gt("Current")}</span>
                ) : undefined,
              run: () => setLanguage(locale),
            };
          }),
        ],
      },
    ],
  };

  return { changeLanguageItem };
}
