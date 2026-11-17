import { decodeOptions, type useMessages } from "gt-react";
import { describe, expect, it } from "vite-plus/test";

import zhTranslations from "../../i18n/translations/zh.json";
import { formatTraitWord, translateTraitText } from "./ComposerModelEffort.logic";

const zhBySource: Readonly<Record<string, string>> = {
  Low: "低",
  "Extra high": "极高",
  "Reasoning effort": "推理强度",
  Thinking: "思考",
  "Fast mode": "快速模式",
  "{label} On": zhTranslations.f42c2a36b3507308,
  "{label} Off": zhTranslations["77cc5f738cb7d459"],
};

const translateZh = ((input: string) => {
  const options = decodeOptions(input) as
    | (Record<string, unknown> & { readonly $_source?: string })
    | undefined;
  const source = options?.$_source ?? input;
  const template = zhBySource[source] ?? source;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(options?.[key] ?? ""));
}) as ReturnType<typeof useMessages>;

describe("ComposerModelEffort trait localization", () => {
  it("maps known trait labels including casing variants and preserves custom labels", () => {
    expect(translateTraitText(translateZh, "Low")).toBe("低");
    expect(translateTraitText(translateZh, "Extra High")).toBe("极高");
    expect(translateTraitText(translateZh, "Reasoning Effort")).toBe("推理强度");
    expect(translateTraitText(translateZh, "Custom Agent Mode")).toBe("Custom Agent Mode");
  });

  it("localizes both text and boolean trait trigger words", () => {
    expect(formatTraitWord(translateZh, { kind: "text", value: "Fast Mode" })).toBe("快速模式");
    expect(
      formatTraitWord(translateZh, { kind: "boolean", label: "Thinking", enabled: true }),
    ).toBe("思考：开");
    expect(
      formatTraitWord(translateZh, { kind: "boolean", label: "Custom Toggle", enabled: false }),
    ).toBe("Custom Toggle：关");
  });
});
