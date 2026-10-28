import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsStore } from "./settings";

let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("SettingsStore", () => {
  it("starts from the defaults and keeps what is set", async () => {
    dir = await mkdtemp(join(tmpdir(), "clipcat-settings-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    expect(await store.get()).toEqual({ agent: "claude", dictionary: [], apiModel: "claude-opus-5-5", claudeModel: null, codexModel: null });
    await store.set({ agent: "codex", codexModel: "gpt-6-luna" });
    expect(await new SettingsStore(join(dir, "settings.json")).get()).toEqual({ agent: "codex", dictionary: [], apiModel: "claude-opus-5-5", claudeModel: null, codexModel: "gpt-6-luna" });
  });

  it("falls back to the defaults when the file is broken", async () => {
    dir = await mkdtemp(join(tmpdir(), "clipcat-settings-"));
    await writeFile(join(dir, "settings.json"), "{nope");
    expect(await new SettingsStore(join(dir, "settings.json")).get()).toEqual({ agent: "claude", dictionary: [], apiModel: "claude-opus-5-5", claudeModel: null, codexModel: null });
  });
});
