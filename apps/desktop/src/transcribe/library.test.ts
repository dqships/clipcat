import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpeechLibrary } from "./library";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clipcat-models-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const bigFile = async (path: string) => {
  await writeFile(path, "");
  await truncate(path, 2_000_000);
};

describe("SpeechLibrary", () => {
  it("lists Parakeet only where it's bundled, and what's on disk", async () => {
    await bigFile(join(dir, "ggml-base.bin"));
    await mkdir(join(dir, "parakeet", "v3"), { recursive: true });
    await bigFile(join(dir, "parakeet", "v3", "Encoder.mlmodelc"));
    const here = await new SpeechLibrary({ modelsDir: dir, parakeet: "/bin/clipcat-parakeet", onProgress: () => {} }).list();
    expect(here.map((m) => [m.id, m.downloaded])).toEqual([
      ["parakeet", true],
      ["large-v3-turbo-q5_0", false],
      ["base", true],
    ]);
    const intel = await new SpeechLibrary({ modelsDir: dir, parakeet: null, onProgress: () => {} }).list();
    expect(intel.map((m) => m.id)).toEqual(["large-v3-turbo-q5_0", "base"]);
  });

  it("removes a model so it downloads again next time", async () => {
    await bigFile(join(dir, "ggml-base.bin"));
    await mkdir(join(dir, "parakeet"), { recursive: true });
    await bigFile(join(dir, "parakeet", "x"));
    const library = new SpeechLibrary({ modelsDir: dir, parakeet: "/bin/clipcat-parakeet", onProgress: () => {} });
    await library.remove("base");
    await library.remove("parakeet");
    expect((await library.list()).every((m) => !m.downloaded)).toBe(true);
  });

  it("refuses Parakeet where it isn't used", async () => {
    await expect(new SpeechLibrary({ modelsDir: dir, parakeet: null, onProgress: () => {} }).download("parakeet")).rejects.toThrow("isn't used");
  });
});
