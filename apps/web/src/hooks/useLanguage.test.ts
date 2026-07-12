import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("language preference", () => {
  it("uses English for an absent or unsupported preference", async () => {
    const storage = createStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const { readLanguagePreference } = await import("./useLanguage");

    expect(readLanguagePreference()).toBe("en");
    storage.setItem("t3code:language", "fr");
    expect(readLanguagePreference()).toBe("en");
  });

  it("persists Chinese and updates the document language", async () => {
    const storage = createStorage();
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("document", { documentElement: { lang: "en" } });
    const { applyLanguage, readLanguagePreference, writeLanguagePreference } =
      await import("./useLanguage");

    writeLanguagePreference("zh-CN");
    applyLanguage("zh-CN");

    expect(readLanguagePreference()).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });
});
