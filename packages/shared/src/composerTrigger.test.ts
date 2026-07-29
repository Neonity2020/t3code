import { describe, expect, it } from "vite-plus/test";

import {
  hasEnabledFlowusCliSkill,
  hasEnabledFlowusCliSkillForProviders,
  rewriteFlowusSlashCommand,
  serializeComposerFileLink,
  serializeComposerMentionPath,
} from "./composerTrigger.ts";

describe("serializeComposerMentionPath", () => {
  it("keeps simple mention paths unquoted", () => {
    expect(serializeComposerMentionPath("src/index.ts")).toBe("src/index.ts");
  });

  it("quotes mention paths containing whitespace", () => {
    expect(serializeComposerMentionPath("docs/My File.md")).toBe('"docs/My File.md"');
  });

  it("escapes quoted mention path content", () => {
    expect(serializeComposerMentionPath('docs/My "File".md')).toBe('"docs/My \\"File\\".md"');
  });
});

describe("serializeComposerFileLink", () => {
  it("uses the basename as the markdown label", () => {
    expect(serializeComposerFileLink("path/to/package.json")).toBe(
      "[package.json](path/to/package.json)",
    );
  });

  it("encodes markdown-sensitive destination characters", () => {
    expect(serializeComposerFileLink("docs/My File (draft).md")).toBe(
      "[My File (draft).md](docs/My%20File%20%28draft%29.md)",
    );
  });

  it("supports windows paths", () => {
    expect(serializeComposerFileLink("C:\\repo\\src\\index.ts")).toBe(
      "[index.ts](C:%5Crepo%5Csrc%5Cindex.ts)",
    );
  });

  it("preserves paths that legitimately start with an at sign", () => {
    expect(serializeComposerFileLink("@scope/package.json")).toBe(
      "[package.json](@scope/package.json)",
    );
  });
});

describe("rewriteFlowusSlashCommand", () => {
  it("rewrites /flowus to the flowus-cli skill mention", () => {
    expect(rewriteFlowusSlashCommand("/flowus")).toBe("$flowus-cli");
    expect(rewriteFlowusSlashCommand("/FLOWUS search text roadmap")).toBe(
      "$flowus-cli search text roadmap",
    );
  });

  it("preserves whitespace and multiline instructions", () => {
    expect(rewriteFlowusSlashCommand("  /flowus create a page\nunder the roadmap")).toBe(
      "  $flowus-cli create a page\nunder the roadmap",
    );
  });

  it("does not rewrite similar commands or inline text", () => {
    expect(rewriteFlowusSlashCommand("/flowus-cli doctor")).toBe("/flowus-cli doctor");
    expect(rewriteFlowusSlashCommand("please run /flowus doctor")).toBe(
      "please run /flowus doctor",
    );
  });
});

describe("hasEnabledFlowusCliSkill", () => {
  it("only accepts an enabled flowus-cli skill", () => {
    expect(
      hasEnabledFlowusCliSkill([
        { name: "other-skill", enabled: true },
        { name: "flowus-cli", enabled: false },
      ]),
    ).toBe(false);
    expect(hasEnabledFlowusCliSkill([{ name: "flowus-cli", enabled: true }])).toBe(true);
  });
});

describe("hasEnabledFlowusCliSkillForProviders", () => {
  it("shares the shortcut when any provider exposes an enabled flowus-cli skill", () => {
    expect(
      hasEnabledFlowusCliSkillForProviders([
        { skills: [] },
        { skills: [{ name: "flowus-cli", enabled: true }] },
      ]),
    ).toBe(true);
  });

  it("does not enable the shortcut for disabled or unrelated skills", () => {
    expect(
      hasEnabledFlowusCliSkillForProviders([
        { skills: [{ name: "flowus-cli", enabled: false }] },
        { skills: [{ name: "other-skill", enabled: true }] },
      ]),
    ).toBe(false);
  });
});
