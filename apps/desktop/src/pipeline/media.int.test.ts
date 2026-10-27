// Runs the real prep pass with a real ffmpeg on a generated clip. Skipped
// unless CLIPCAT_TEST_FFMPEG names a folder holding ffmpeg and ffprobe
// (CI points it at the bundled build; locally, any ffmpeg 6+ with libflite).

import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobQueue, type JobEvent } from "../jobs/queue";
import { ProjectStore } from "../store/projects";
import { realDeps } from "./deps";
import { ImportPipeline } from "./import";

const binDir = process.env.CLIPCAT_TEST_FFMPEG;
const exe = (name: string) => join(binDir ?? "", process.platform === "win32" ? `${name}.exe` : name);
const run = promisify(execFile);

describe.skipIf(!binDir)("prep with real ffmpeg", () => {
  let root: string;
  let clip: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "clipcat-int-"));
    clip = join(root, "clip.mp4");
    // Two tones with 2.5 s of silence between them, over a test picture.
    await run(exe("ffmpeg"), [
      "-hide_banner", "-y",
      "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=6",
      "-f", "lavfi", "-i", "sine=f=220:d=1.5,volume=0.5",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=2.5",
      "-f", "lavfi", "-i", "sine=f=330:d=2,volume=0.5",
      "-filter_complex", "[1:a]aresample=48000[a1];[3:a]aresample=48000[a3];[a1][2:a][a3]concat=n=3:v=0:a=1[a]",
      "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      clip,
    ]);
  }, 60_000);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("probes, preps and finds the pause", async () => {
    const events: JobEvent[] = [];
    const store = new ProjectStore(join(root, "projects"));
    const pipeline = new ImportPipeline({
      ...realDeps({ ffmpeg: exe("ffmpeg"), ffprobe: exe("ffprobe"), whisper: "", modelsDir: "", model: "base", encoder: "libx264" }),
      // No speech model in CI: stand in for whisper with the words we generated, timed
      // in the speech audio, where 1.7 s to 3.8 s of the pause was taken out.
      ensureModel: async () => ({ model: "fake", path: "" }),
      transcribe: async () => ({
        transcription: [
          { offsets: { from: 200, to: 1300 }, text: " one" },
          { offsets: { from: 1900, to: 3500 }, text: " two" },
        ],
      }),
      store,
      queue: new JobQueue((e) => events.push(e)),
      changed: () => {},
    });
    const created = await pipeline.import([clip], null);
    for (let i = 0; i < 600 && events.filter((e) => e.state === "done" || e.state === "failed").length < 3; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(events.filter((e) => e.state === "failed")).toEqual([]);

    const p = await store.get(created.id);
    const s = p.sources[0]!;
    expect(s.media.duration).toBeGreaterThan(5.5);
    const dir = store.mediaDir(p.id, s.id);
    const files = await readdir(dir);
    expect(files).toEqual(expect.arrayContaining(["proxy.mp4", "audio.wav", "speech.wav", "waveform.png", "thumb-0001.jpg"]));
    expect(p.transcript[1]!.start).toBeCloseTo(4, 0);
    expect((await stat(join(dir, "proxy.mp4"))).size).toBeGreaterThan(10_000);
    const proxy = await realDeps({ ffmpeg: "", ffprobe: exe("ffprobe"), whisper: "", modelsDir: "", model: "base", encoder: "libx264" }).probe(
      join(dir, "proxy.mp4"),
    );
    expect(proxy.height).toBe(720);
    expect(proxy.vfr).toBe(false);

    const cuts = p.proposals.filter((x) => x.type === "silence").map((x) => x.cuts[0]!);
    expect(cuts.some(([a, b]) => a > 1.4 && a < 1.8 && b > 3.8 && b < 4.2)).toBe(true);
    expect(events.some((e) => e.kind === "prep" && e.state === "running" && (e.fraction ?? 0) > 0.5)).toBe(true);
  }, 120_000);
});
