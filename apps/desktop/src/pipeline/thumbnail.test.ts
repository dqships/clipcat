import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobQueue } from "../jobs/queue";
import { ProjectStore } from "../store/projects";
import { THUMBNAIL_DIR, ThumbnailPipeline } from "./thumbnail";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "clipcat-thumbnail-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const media = { duration: 60, width: 1920, height: 1080, fps: 30, vfr: false, videoCodec: "h264", audioCodec: "aac" };

async function setup(coverage = 0.3) {
  const store = new ProjectStore(root);
  const queue = new JobQueue(() => {});
  const grabbed: { file: string; time: number }[] = [];
  const pipeline = new ThumbnailPipeline({
    store,
    queue,
    grab: async (file, time, out) => {
      grabbed.push({ file, time });
      await writeFile(out, "jpeg");
    },
    cutout: async (picture) => ({ png: Buffer.concat([Buffer.from("cut:"), picture]), coverage }),
    changed: () => {},
  });
  const { id } = await store.create("talk");
  await store.update(id, null, (p) => {
    p.sources.push({ id: "s1", name: "take.mov", path: "/v/take.mov", order: 0, media, frameX: 0.5, framing: "auto", faces: null, prep: null, transcription: null, silenceRanges: [] });
  });
  return { store, queue, pipeline, grabbed, id };
}

describe("ThumbnailPipeline", () => {
  it("grabs the frame from the preview copy when the original is gone", async () => {
    const { store, queue, pipeline, grabbed, id } = await setup();
    await store.update(id, null, (p) => {
      p.sources[0]!.prep = { proxy: "media/s1/proxy.mp4", wav: "", waveform: "", thumbs: "" };
    });
    await pipeline.pick(id, "s1", 3);
    await queue.idle(id);
    expect(grabbed).toEqual([{ file: join(store.dir(id), "media/s1/proxy.mp4"), time: 3 }]);
  });

  it("grabs the frame from the original recording and cuts the subject out of it", async () => {
    const { store, queue, pipeline, grabbed, id } = await setup();
    await pipeline.pick(id, "s1", 12.5);
    await queue.idle(id);
    const t = (await store.get(id)).thumbnail!;
    expect(grabbed).toEqual([{ file: "/v/take.mov", time: 12.5 }]);
    expect(t).toMatchObject({ sourceId: "s1", time: 12.5, text: "", textColor: "paper", background: "frame", textSide: "left" });
    expect(t.frame).toMatch(new RegExp(`^${THUMBNAIL_DIR}/frame-[a-f0-9-]{8}\\.jpg$`));
    expect(await readFile(join(store.dir(id), t.subject!), "utf8")).toBe("cut:jpeg");
  });

  it("keeps the text and colours, and only the new pictures, when another frame is picked", async () => {
    const { store, queue, pipeline, grabbed, id } = await setup();
    await pipeline.pick(id, "s1", 5);
    await queue.idle(id);
    await store.update(id, null, (p) => {
      p.thumbnail!.text = "Big words";
      p.thumbnail!.background = "blur";
      p.thumbnail!.textBox = { x: 0.2, y: 0.2, width: 0.4, height: 0.3 };
    });
    await pipeline.pick(id, "s1", 99);
    await queue.idle(id);
    const t = (await store.get(id)).thumbnail!;
    expect(t).toMatchObject({ text: "Big words", background: "blur", textBox: { x: 0.2, y: 0.2, width: 0.4, height: 0.3 }, time: 59.95 });
    expect(grabbed.at(-1)!.time).toBe(59.95);
    expect((await readdir(join(store.dir(id), THUMBNAIL_DIR))).sort()).toEqual([t.frame, t.subject].map((x) => x!.split("/").at(-1)).sort());
  });

  it("leaves the subject out when nothing in the frame stands out", async () => {
    const { store, queue, pipeline, id } = await setup(0.001);
    await pipeline.pick(id, "s1", 1);
    await queue.idle(id);
    expect((await store.get(id)).thumbnail!.subject).toBeNull();
    expect(await readdir(join(store.dir(id), THUMBNAIL_DIR))).toHaveLength(1);
  });

  it("refuses a recording the project doesn't have", async () => {
    const { pipeline, id } = await setup();
    await expect(pipeline.pick(id, "nope", 1)).rejects.toThrow("Unknown recording");
  });
});
