import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isTempPath, writeFileAtomic } from "./atomic";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clipcat-atomic-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("writes the whole file and leaves no temp file behind", async () => {
    const target = join(dir, "project.json");
    await writeFileAtomic(target, '{"a":1}');
    await writeFileAtomic(target, '{"a":2}');
    expect(await readFile(target, "utf8")).toBe('{"a":2}');
    expect((await readdir(dir)).filter(isTempPath)).toEqual([]);
  });

  it("cleans up when the target folder is missing", async () => {
    await expect(writeFileAtomic(join(dir, "nope", "x.json"), "x")).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});
