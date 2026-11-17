import { msg, type useMessages } from "gt-react";

type MessageTranslator = ReturnType<typeof useMessages>;

export const COMMON_TRAIT_LABELS: Readonly<Record<string, string>> = {
  None: msg("None"),
  Off: msg("Off"),
  On: msg("On"),
  Minimal: msg("Minimal"),
  Low: msg("Low"),
  Medium: msg("Medium"),
  High: msg("High"),
  "Extra high": msg("Extra high"),
  "Extra High": msg("Extra high"),
  Max: msg("Max"),
  Auto: msg("Auto"),
  Fast: msg("Fast"),
  "Fast mode": msg("Fast mode"),
  "Fast Mode": msg("Fast mode"),
  Ultrafast: msg("Ultrafast"),
  Ultrathink: msg("Ultrathink"),
  Standard: msg("Standard"),
  Effort: msg("Effort"),
  Reasoning: msg("Reasoning"),
  "Reasoning effort": msg("Reasoning effort"),
  "Reasoning Effort": msg("Reasoning effort"),
  Thinking: msg("Thinking"),
  "Extended thinking": msg("Extended thinking"),
  "Extended Thinking": msg("Extended thinking"),
  "Thinking level": msg("Thinking level"),
  "Thinking Level": msg("Thinking level"),
};

export type TraitWordDisplay =
  | { readonly kind: "boolean"; readonly label: string; readonly enabled: boolean }
  | { readonly kind: "text"; readonly value: string };

export function translateTraitText(m: MessageTranslator, value: string): string {
  const mapped = COMMON_TRAIT_LABELS[value];
  return mapped ? m(mapped) : value;
}

export function formatTraitWord(m: MessageTranslator, word: TraitWordDisplay): string {
  if (word.kind === "text") {
    return translateTraitText(m, word.value);
  }
  const label = translateTraitText(m, word.label);
  return m(word.enabled ? msg("{label} On", { label }) : msg("{label} Off", { label }));
}
