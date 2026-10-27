import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectStore, RevisionConflict } from "./projects";

let root: string;
let store: ProjectStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "clipcat-store-"));
  store = new ProjectStore(root);
});
afterEach(async () => rm(root, { recursive: true, force: true }));

describe("ProjectStore", () => {
  it("creates, lists and reads back a project", async () => {
    const p = await store.create("Launch video");
    expect((await store.list()).map((s) => s.name)).toEqual(["Launch video"]);
    expect((await store.get(p.id)).revision).toBe(0);
    expect(await readFile(join(root, p.id, "events.jsonl"), "utf8")).toMatch(/"created"/);
  });

  it("bumps the revision and refuses a stale save", async () => {
    const p = await store.create("x");
    const next = await store.update(p.id, 0, (d) => {
      d.name = "renamed";
    });
    expect(next.revision).toBe(1);
    await expect(store.update(p.id, 0, (d) => void (d.name = "lost"))).rejects.toBeInstanceOf(RevisionConflict);
    expect((await store.get(p.id)).name).toBe("renamed");
  });

  it("serialises concurrent job updates without losing any", async () => {
    const p = await store.create("x");
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.update(p.id, null, (d) => {
          d.brief += String(i % 10);
        }),
      ),
    );
    const final = await store.get(p.id);
    expect(final.revision).toBe(20);
    expect(final.brief).toHaveLength(20);
  });

  it("rejects ids that could escape the root", () => {
    expect(() => store.dir("../etc")).toThrow();
    expect(() => store.mediaDir("ok", "../../x")).toThrow();
  });
});
