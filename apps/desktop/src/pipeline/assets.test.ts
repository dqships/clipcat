import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobQueue, type JobEvent } from "../jobs/queue";
import { ProjectStore } from "../store/projects";
import { AssetPipeline, assetPaths } from "./assets";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "clipcat-media-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function setup() {
  const events: JobEvent[] = [];
  const store = new ProjectStore(root);
  const queue = new JobQueue((e) => events.push(e));
  const described: string[] = [];
  const prepared: { preview: string; frames: string[] }[] = [];
  const media = new AssetPipeline({
    store,
    queue,
    probe: async (file) => {
      if (file.endsWith(".pdf")) throw new Error("Add a picture or a video.");
      return file.endsWith(".png") ? { kind: "image", media: { duration: 0, width: 400, height: 300 } } : { kind: "video", media: { duration: 8, width: 1920, height: 1080 } };
    },
    prep: async (_asset, out) => void prepared.push(out),
    describe: (id) => void described.push(id),
    changed: () => {},
  });
  const project = await store.create("talk");
  return { store, queue, events, media, described, prepared, id: project.id };
}

describe("AssetPipeline", () => {
  it("adds media, prepares each in the project's folder and asks for descriptions", async () => {
    const { store, queue, media, described, prepared, id } = await setup();
    const added = await media.add(id, ["/m/drone.mp4", "/m/logo.png"]);
    expect(added.assets.map((a) => [a.name, a.kind, a.prep])).toEqual([
      ["drone.mp4", "video", null],
      ["logo.png", "image", null],
    ]);
    expect(described).toEqual([id]);
    await queue.idle(id);

    const p = await store.get(id);
    const [video, picture] = p.assets;
    expect(video!.prep).toEqual({ preview: `media/assets/${video!.id}/preview.mp4`, frames: [1, 2, 3].map((n) => `media/assets/${video!.id}/frame-${n}.jpg`) });
    expect(picture!.prep!.frames).toHaveLength(1);
    expect(prepared[0]!.preview).toBe(join(store.dir(id), video!.prep!.preview));
    expect((await stat(join(store.dir(id), assetPaths(video!).dir))).isDirectory()).toBe(true);
  });

  it("refuses the whole batch when one file isn't media", async () => {
    const { store, media, id } = await setup();
    await expect(media.add(id, ["/m/drone.mp4", "/m/notes.pdf"])).rejects.toThrow("notes.pdf: Add a picture or a video.");
    expect((await store.get(id)).assets).toEqual([]);
  });

  it("prepares what an earlier run didn't, and deletes a removed item's files", async () => {
    const { store, queue, media, described, id } = await setup();
    const added = await media.add(id, ["/m/drone.mp4"]);
    await queue.idle(id);
    await store.update(id, null, (p) => {
      p.assets.push({ ...added.assets[0]!, id: "m-late", prep: null });
    });
    await media.resume();
    await queue.idle(id);
    expect((await store.get(id)).assets.every((a) => a.prep)).toBe(true);
    expect(described).toEqual([id, id]);

    await media.forget(id, "m-late");
    expect(await readdir(join(store.dir(id), "media", "assets"))).toEqual([added.assets[0]!.id]);
  });
});
