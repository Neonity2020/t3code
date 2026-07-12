import { useCallback, useEffect, useSyncExternalStore } from "react";

export const LANGUAGE_OPTIONS = ["en", "zh-CN"] as const;
export type Language = (typeof LANGUAGE_OPTIONS)[number];

const STORAGE_KEY = "t3code:language";
const DEFAULT_LANGUAGE: Language = "en";

let listeners: Array<() => void> = [];
let lastLanguage: Language | null = null;

function emitChange() {
  for (const listener of listeners) listener();
}

export function readLanguagePreference(): Language {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "zh-CN" || value === "en" ? value : DEFAULT_LANGUAGE;
}

export function writeLanguagePreference(language: Language): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, language);
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && LANGUAGE_OPTIONS.some((option) => option === value);
}

export function applyLanguage(language: Language) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
}

function getSnapshot(): Language {
  const language = readLanguagePreference();
  if (lastLanguage === language) return lastLanguage;
  lastLanguage = language;
  return language;
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.push(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) emitChange();
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners = listeners.filter((candidate) => candidate !== listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function useLanguage() {
  const language = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_LANGUAGE);

  useEffect(() => {
    applyLanguage(language);
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    writeLanguagePreference(next);
    applyLanguage(next);
    emitChange();
  }, []);

  return { language, setLanguage } as const;
}
