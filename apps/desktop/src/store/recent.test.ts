import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RECENT_LIMIT, RecentProjects } from "./recent";

const store = async () => new RecentProjects(join(await mkdtemp(join(tmpdir(), "recent-")), "recent.json"));

describe("RecentProjects", () => {
  it("starts empty, and treats a broken file as empty", async () => {
    const recent = await store();
    expect(await recent.list()).toEqual([]);
    const file = join(await mkdtemp(join(tmpdir(), "recent-")), "recent.json");
    await writeFile(file, "{not json");
    expect(await new RecentProjects(file).list()).toEqual([]);
  });

  it("keeps the newest first, each once, up to the limit", async () => {
    const recent = await store();
    await recent.opened("a");
    await recent.opened("b");
    await recent.opened("a");
    expect(await recent.list()).toEqual(["a", "b"]);
    await Promise.all(Array.from({ length: RECENT_LIMIT + 2 }, (_, i) => recent.opened(`p${i}`)));
    const ids = await recent.list();
    expect(ids).toHaveLength(RECENT_LIMIT);
    expect(ids[0]).toBe(`p${RECENT_LIMIT + 1}`);
  });

  it("clears", async () => {
    const recent = await store();
    await recent.opened("a");
    await recent.clear();
    expect(await recent.list()).toEqual([]);
  });
});
