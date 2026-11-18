import { describe, expect, it } from "vite-plus/test";

import { nativeLanguageName, resolveLocale, SYSTEM_LANGUAGE } from "./locales.ts";

describe("locales", () => {
  const supported = ["en", "de", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh"];

  it("returns explicit supported locales directly", () => {
    expect(resolveLocale("zh", ["en-US"], supported, "en")).toBe("zh");
    expect(resolveLocale("en", ["zh-CN"], supported, "en")).toBe("en");
  });

  it("resolves system language from host locales including Simplified vs Traditional Chinese", () => {
    expect(resolveLocale(SYSTEM_LANGUAGE, ["zh-CN", "en-US"], supported, "en")).toBe("zh");
    expect(resolveLocale(SYSTEM_LANGUAGE, ["zh-Hans-CN"], supported, "en")).toBe("zh");
    // Traditional Chinese falls back to next supported locale or default instead of Simplified zh.
    expect(resolveLocale(SYSTEM_LANGUAGE, ["zh-TW", "en-US"], supported, "en")).toBe("en");
    expect(resolveLocale(SYSTEM_LANGUAGE, ["fr-CA"], supported, "en")).toBe("fr");
    expect(resolveLocale(SYSTEM_LANGUAGE, ["unknown"], supported, "en")).toBe("en");
  });

  it("formats native language names", () => {
    expect(nativeLanguageName("en")).toBe("English");
    expect(nativeLanguageName("zh")).toBe("中文（简体）");
  });
});
