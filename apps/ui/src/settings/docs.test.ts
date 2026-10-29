// Keeps the help pages in step with the settings: each setting ClipCat saves
// has to be named on the help page that covers it, so a new setting can't ship
// undocumented.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Settings } from "@clipcat/ipc";
import { describe, expect, it } from "vitest";

const doc = (page: string) => readFileSync(join(__dirname, "..", "..", "..", "..", "docs", page), "utf8");

/** Each saved setting, the help page that explains it, and the label the app shows for it. */
const WHERE: Record<keyof typeof Settings.shape, [page: string, label: string]> = {
  agent: ["ai-editor.md", "**Use**"],
  dictionary: ["transcript.md", "**Fix the spelling of names**"],
  apiModel: ["ai-editor.md", "Opus 5.5 (best), Sonnet 5.5, or Haiku 5.5 (cheapest)"],
  claudeModel: ["ai-editor.md", "**Model**, for Claude Code and Codex"],
  codexModel: ["ai-editor.md", "**Model**, for Claude Code and Codex"],
  speechLanguage: ["settings.md", "**Language for new projects**"],
  speechEngine: ["settings.md", "**Engine**"],
  whisperModel: ["settings.md", "**Whisper model**"],
};

describe("the help pages", () => {
  it("explain every setting", () => {
    for (const key of Object.keys(Settings.shape) as (keyof typeof WHERE)[]) {
      const [page, label] = WHERE[key] ?? [];
      expect(page, `${key} needs a line in docs/ and an entry here`).toBeDefined();
      expect(doc(page!), `docs/${page} doesn't explain ${key}`).toContain(label);
    }
  });
});
