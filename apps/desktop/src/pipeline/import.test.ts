import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MediaInfo, Project } from "@clipcat/core";
import { JobQueue, type JobEvent } from "../jobs/queue";
import { ProjectStore } from "../store/projects";
import { ImportPipeline, type PipelineDeps } from "./import";

const media: MediaInfo = { duration: 10, width: 1920, height: 1080, fps: 30, vfr: false, videoCodec: "h264", audioCodec: "aac" };

/** 10 s at 16 kHz: speech-level noise with a quiet stretch from 3 s to 6 s. */
function pcm() {
  const rate = 16000;
  const samples = new Float32Array(rate * 10);
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    samples[i] = (t >= 3 && t < 6 ? 0.0005 : 0.3) * Math.sin(i * 0.37);
  }
  return { sampleRate: rate, samples };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "clipcat-pipe-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function setup(over: Partial<PipelineDeps> = {}) {
  const events: JobEvent[] = [];
  const store = new ProjectStore(root);
  const queue = new JobQueue((e) => events.push(e));
  const changes: Project[] = [];
  const heard: string[] = [];
  const seconds: number[] = [];
  const deps: PipelineDeps = {
    store,
    queue,
    probe: async (file) => {
      if (file.endsWith(".txt")) throw new Error("not a media file");
      return media;
    },
    prep: async () => {},
    // Times in the speech audio, where 3.2 s to 5.8 s of the quiet stretch was taken out.
    transcribe: async (opts) => {
      heard.push(opts.wav);
      return {
        backend: "parakeet",
        model: "parakeet-tdt-0.6b-v3",
        json: {
          transcription: [
            { offsets: { from: 500, to: 900 }, text: " Hello" },
            { offsets: { from: 900, to: 1000 }, text: "." },
            { offsets: { from: 3600, to: 4100 }, text: " Again" },
          ],
        },
      };
    },
    faces: async () => [{ t: 0, x: 0.7 }],
    readWav: async () => pcm(),
    writeWav: async (_path, written) => {
      seconds.push(written.samples.length / written.sampleRate);
    },
    changed: (p) => changes.push(p),
    ...over,
  };
  return { pipeline: new ImportPipeline(deps), store, events, changes, heard, seconds };
}

const settle = async (events: JobEvent[], n: number) => {
  for (let i = 0; i < 200 && events.filter((e) => ["done", "failed", "cancelled"].includes(e.state)).length < n; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("ImportPipeline", () => {
  it("imports, transcribes and proposes the long pause", async () => {
    const { pipeline, store, events, heard, seconds } = setup();
    const created = await pipeline.import(["/videos/talk.mp4"], null);
    expect(created.name).toBe("talk");
    expect(created.segments).toHaveLength(1);
    await settle(events, 4);

    const p = await store.get(created.id);
    const s = p.sources[0]!;
    expect(s.prep?.proxy).toBe(`media/${s.id}/proxy.mp4`);
    expect(s.transcription).toEqual({ backend: "parakeet", model: "parakeet-tdt-0.6b-v3" });
    expect(p.transcript.map((w) => [w.id, w.text])).toEqual([
      [`${s.id}-0`, "Hello."],
      [`${s.id}-1`, "Again"],
    ]);
    // Whisper heard the speech without the long pause; its times were mapped back.
    expect(heard[0]).toMatch(/speech\.wav$/);
    expect(seconds[0]).toBeCloseTo(7.4, 1);
    expect(p.transcript[1]!.start).toBeCloseTo(6.2, 1);
    const silence = p.proposals.filter((x) => x.type === "silence");
    expect(silence).toHaveLength(1);
    const [[a, b]] = silence[0]!.cuts as [[number, number]];
    expect(a).toBeCloseTo(3.12, 1);
    expect(b).toBeCloseTo(5.88, 1);
    expect(events.filter((e) => e.state === "done").map((e) => e.kind)).toEqual(["prep", "transcribe", "silence", "faces"]);
    expect(s.faces).toEqual([{ t: 0, x: 0.7 }]);
  });

  it("refuses a file it can't read before creating anything", async () => {
    const { pipeline, store } = setup();
    await expect(pipeline.import(["/videos/a.mp4", "/notes.txt"], null)).rejects.toThrow("notes.txt: not a media file");
    expect(await store.list()).toEqual([]);
  });

  it("skips transcription when prep fails, and resume picks it up again", async () => {
    let fail = true;
    const { pipeline, store, events } = setup({
      prep: async () => {
        if (fail) throw new Error("disk full");
      },
    });
    const created = await pipeline.import(["/videos/talk.mp4"], null);
    await settle(events, 4);
    expect(events.find((e) => e.state === "failed")?.error).toBe("disk full");
    expect((await store.get(created.id)).sources[0]?.transcription).toBeNull();

    fail = false;
    events.length = 0;
    await pipeline.resume();
    await settle(events, 4);
    expect((await store.get(created.id)).transcript).toHaveLength(2);
    expect((await store.get(created.id)).sources[0]?.faces).toHaveLength(1);
  });

  it("adds files to an existing project in order", async () => {
    const { pipeline, store, events } = setup();
    const created = await pipeline.import(["/videos/one.mp4"], null);
    await pipeline.import(["/videos/two.mp4"], created.id);
    await settle(events, 8);
    const p = await store.get(created.id);
    expect(p.sources.map((s) => [s.name, s.order])).toEqual([
      ["one.mp4", 0],
      ["two.mp4", 1],
    ]);
    expect(p.transcript.map((w) => w.sourceId)).toEqual([p.sources[0]!.id, p.sources[0]!.id, p.sources[1]!.id, p.sources[1]!.id]);
  });

  it("keeps a silence cut the user already decided on", async () => {
    const { pipeline, store, events } = setup();
    const created = await pipeline.import(["/videos/talk.mp4"], null);
    await settle(events, 4);
    const p = await store.update(created.id, null, (d) => {
      d.proposals[0]!.status = "rejected";
    });
    events.length = 0;
    await pipeline.retranscribe(p.id, p.sources[0]!.id);
    await settle(events, 2);
    const after = await store.get(created.id);
    expect(after.proposals.map((x) => x.status)).toEqual(["rejected"]);
  });

  it("looks for faces again on resume only where it never finished, and leaves them unknown without a detector", async () => {
    let looked = 0;
    const { pipeline, store, events } = setup({
      faces: async () => {
        looked++;
        return null;
      },
    });
    const created = await pipeline.import(["/videos/talk.mp4"], null);
    await settle(events, 4);
    expect((await store.get(created.id)).sources[0]?.faces).toBeNull();
    events.length = 0;
    await store.update(created.id, null, (d) => {
      d.sources[0]!.faces = [];
    });
    await pipeline.resume();
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toEqual([]);
    expect(looked).toBe(1);
  });
});
