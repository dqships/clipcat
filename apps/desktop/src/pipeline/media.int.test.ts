// Runs the real prep pass with a real ffmpeg on a generated clip. Skipped
// unless CLIPCAT_TEST_FFMPEG names a folder holding ffmpeg and ffprobe
// (CI points it at the bundled build; locally, any ffmpeg 6+ with libflite).

import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { applyEdit, buildTimeline, defaultOverlay, overlayBox, overlayProposal, punchProposal, slideAsset, soundProposal, timedOverlays, timedSounds } from "@clipcat/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobQueue, type JobEvent } from "../jobs/queue";
import { runFfmpeg } from "../media/run";
import { ProjectStore } from "../store/projects";
import { AssetPipeline } from "./assets";
import { realAssetDeps, realDeps, realMusicDeps, realThumbnailDeps } from "./deps";
import { ExportRunner, srtPath } from "./export";
import { ImportPipeline } from "./import";
import { MusicPipeline } from "./music";
import { ThumbnailPipeline } from "./thumbnail";

const binDir = process.env.CLIPCAT_TEST_FFMPEG;
const exe = (name: string) => join(binDir ?? "", process.platform === "win32" ? `${name}.exe` : name);
const run = promisify(execFile);
const sw = async () => "libx264" as const;

/** Seconds of video and of audio in a file, from the streams' own durations. */
async function streamDurations(file: string): Promise<{ video: number; audio: number }> {
  const { stdout } = await run(exe("ffprobe"), ["-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "json", file]);
  const streams = (JSON.parse(stdout) as { streams: { codec_type: string; duration: string }[] }).streams;
  const of = (type: string) => Number(streams.find((s) => s.codec_type === type)?.duration ?? Number.NaN);
  return { video: of("video"), audio: of("audio") };
}

describe.skipIf(!binDir)("prep with real ffmpeg", () => {
  let root: string;
  let clip: string;
  let store: ProjectStore;
  let projectId = "";

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
    store = new ProjectStore(join(root, "projects"));
    // A stand-in for the system's face detector: one face right of centre in every frame.
    const frames: Buffer[] = [];
    const faceDetector = async () => async (jpegs: Buffer[]) => {
      frames.push(...jpegs);
      return jpegs.map(() => [{ x: 0.6, y: 0.2, width: 0.2, height: 0.3 }]);
    };
    const pipeline = new ImportPipeline({
      ...realDeps({ ffmpeg: exe("ffmpeg"), ffprobe: exe("ffprobe"), whisper: "", parakeet: null, modelsDir: "", model: "base", encoder: sw, faceDetector }),
      // No speech model in CI: stand in for whisper with the words we generated, timed
      // in the speech audio, where 1.7 s to 3.8 s of the pause was taken out.
      transcribe: async () => ({
        backend: "fake",
        model: "fake",
        json: {
          transcription: [
            { offsets: { from: 200, to: 1300 }, text: " one" },
            { offsets: { from: 1900, to: 3500 }, text: " two" },
          ],
        },
      }),
      store,
      queue: new JobQueue((e) => events.push(e)),
      changed: () => {},
    });
    const created = await pipeline.import([clip], null);
    projectId = created.id;
    for (let i = 0; i < 600 && events.filter((e) => e.state === "done" || e.state === "failed").length < 4; i++) {
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
    const proxy = await realDeps({ ffmpeg: "", ffprobe: exe("ffprobe"), whisper: "", parakeet: null, modelsDir: "", model: "base", encoder: sw }).probe(
      join(dir, "proxy.mp4"),
    );
    expect(proxy.height).toBe(720);
    expect(proxy.vfr).toBe(false);

    const cuts = p.proposals.filter((x) => x.type === "silence").map((x) => x.cuts[0]!);
    expect(cuts.some(([a, b]) => a > 1.4 && a < 1.8 && b > 3.8 && b < 4.2)).toBe(true);
    expect(events.some((e) => e.kind === "prep" && e.state === "running" && (e.fraction ?? 0) > 0.5)).toBe(true);

    // A frame every 2 s from the start, as JPEGs, and the frames cleaned up after.
    expect(s.faces).toEqual([0, 2, 4].map((t) => ({ t, x: 0.7 })));
    expect(frames.every((f) => f[0] === 0xff && f[1] === 0xd8)).toBe(true);
    expect(files.includes("faces")).toBe(false);
  }, 120_000);

  it("exports both shapes with captions and an SRT", async () => {
    expect(projectId).not.toBe("");
    const p = await store.get(projectId);
    const pause = p.proposals.find((x) => x.type === "silence")!;
    let n = 0;
    await store.update(projectId, null, (q) => applyEdit(q, { type: "decide", ids: [pause.id], status: "accepted" }, () => `e${++n}`));
    // A punch-in of each kind, the slow one across the cut pause, so the zooms run through ffmpeg too.
    await store.update(projectId, null, (q) => {
      const s = q.sources[0]!.id;
      const at = (id: string, range: [number, number], style: "cut" | "zoom-in" | "slow-zoom") =>
        punchProposal({ id, sourceId: s, wordIds: [], reason: "", confidence: 1, status: "accepted" }, range, style);
      q.proposals.push(at("k1", [0.2, 0.8], "cut"), at("k2", [0.9, 4.6], "slow-zoom"), at("k3", [4.8, 5.6], "zoom-in"));
    });
    const deps = {
      store,
      queue: new JobQueue(() => {}),
      changed: () => {},
      ffmpeg: (args: string[], { cwd, duration, ctx }: { cwd: string; duration: number; ctx: { signal: AbortSignal } }) =>
        runFfmpeg(exe("ffmpeg"), args, { cwd, duration, signal: ctx.signal }),
      encoder: sw,
      fontsDir: join(__dirname, "..", "..", "resources", "fonts"),
      sfxDir: join(__dirname, "..", "..", "resources", "sfx"),
    };
    const exporter = new ExportRunner(deps);
    const ctx = { signal: new AbortController().signal, progress: () => {} };
    const probe = realDeps({ ffmpeg: "", ffprobe: exe("ffprobe"), whisper: "", parakeet: null, modelsDir: "", model: "base", encoder: sw }).probe;

    const wide = join(root, "wide.mp4");
    await exporter.run(projectId, "16:9", wide, ctx);
    const w = await probe(wide);
    expect([w.width, w.height]).toEqual([1280, 720]);
    // 6 s with the 2.1 s pause cut.
    expect(w.duration).toBeGreaterThan(3.4);
    expect(w.duration).toBeLessThan(4.4);
    expect(w.audioCodec).toBe("aac");
    const srt = await readFile(srtPath(wide), "utf8");
    expect(srt).toContain("one");
    expect(srt).toContain("two");

    const tall = join(root, "tall.mp4");
    await exporter.run(projectId, "9:16", tall, ctx);
    const t = await probe(tall);
    expect([t.width, t.height]).toEqual([1080, 1920]);
    expect((await store.get(projectId)).lastExport).toMatchObject({ path: tall, format: "9:16" });
    expect((await readdir(root)).some((f) => f.includes("partial"))).toBe(false);

    // A long video's path: chunks of about a second, joined, at 1.25× speed.
    await store.update(projectId, null, (q) => {
      q.speed = 1.25;
    });
    const chunked = new ExportRunner({ ...deps, chunkSeconds: 1 });
    const fast = join(root, "fast.mp4");
    await chunked.run(projectId, "16:9", fast, ctx);
    const f = await probe(fast);
    expect(f.duration).toBeGreaterThan(w.duration / 1.25 - 0.15);
    expect(f.duration).toBeLessThan(w.duration / 1.25 + 0.15);
    // Picture and sound end together: the chunks join without a gap or drift.
    const streams = await streamDurations(fast);
    expect(Math.abs(streams.video - streams.audio)).toBeLessThan(0.05);
    expect((await readdir(store.dir(projectId))).includes("export")).toBe(false);
  }, 180_000);

  it("prepares b-roll media and renders it full frame and in a round window", async () => {
    expect(projectId).not.toBe("");
    await store.update(projectId, null, (q) => {
      q.speed = 1;
      q.proposals = q.proposals.filter((x) => !x.punch);
    });
    // A clip and a picture in colours the test picture doesn't have, so their pixels are easy to find in the export.
    const red = join(root, "red.mov");
    const blue = join(root, "blue.png");
    await run(exe("ffmpeg"), ["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=0xC08040:s=640x360:r=25:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", red]);
    await run(exe("ffmpeg"), ["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=0x40C0A0:s=400x400", "-frames:v", "1", blue]);
    const events: JobEvent[] = [];
    let described = 0;
    const media = new AssetPipeline({
      ...realAssetDeps({ ffmpeg: exe("ffmpeg"), ffprobe: exe("ffprobe"), encoder: sw }),
      store,
      queue: new JobQueue((e) => events.push(e)),
      changed: () => {},
      describe: () => void described++,
    });
    await media.add(projectId, [red, blue]);
    for (let i = 0; i < 400 && events.filter((e) => e.state === "done" || e.state === "failed").length < 2; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(events.filter((e) => e.state === "failed")).toEqual([]);
    expect(described).toBe(1);
    const p = await store.get(projectId);
    const [clipAsset, picture] = p.assets;
    expect(clipAsset).toMatchObject({ kind: "video", media: { width: 640, height: 360 } });
    expect(clipAsset!.media.duration).toBeCloseTo(3, 0);
    expect(picture).toMatchObject({ kind: "image", media: { duration: 0, width: 400, height: 400 } });
    for (const a of p.assets) {
      for (const f of [a.prep!.preview, ...a.prep!.frames]) expect((await stat(join(store.dir(projectId), f))).size).toBeGreaterThan(100);
    }
    expect(clipAsset!.prep!.frames).toHaveLength(3);

    const s = p.sources[0]!.id;
    await store.update(projectId, null, (q) => {
      const at = (id: string, range: [number, number], assetId: string, placement: "full" | "pip") =>
        overlayProposal({ id, sourceId: s, wordIds: [], reason: "", confidence: 1, status: "accepted" }, defaultOverlay(range, assetId, placement));
      q.proposals.push(at("o1", [0.3, 1.3], clipAsset!.id, "full"), { ...at("o2", [4.2, 5.4], picture!.id, "pip") });
      q.proposals.at(-1)!.overlay!.shape = "circle";
    });
    const q = await store.get(projectId);
    const [full, pip] = timedOverlays(q, buildTimeline(q));
    const deps = {
      store,
      queue: new JobQueue(() => {}),
      changed: () => {},
      ffmpeg: (args: string[], { cwd, duration, ctx }: { cwd: string; duration: number; ctx: { signal: AbortSignal } }) =>
        runFfmpeg(exe("ffmpeg"), args, { cwd, duration, signal: ctx.signal }),
      encoder: sw,
      fontsDir: join(__dirname, "..", "..", "resources", "fonts"),
      sfxDir: join(__dirname, "..", "..", "resources", "sfx"),
    };
    // Chunks of a second, so b-roll is cut across chunks too.
    const out = join(root, "broll.mp4");
    await new ExportRunner({ ...deps, chunkSeconds: 1 }).run(projectId, "16:9", out, { signal: new AbortController().signal, progress: () => {} });

    const pixel = async (t: number, x: number, y: number) => {
      const { stdout } = await promisify(execFile)(
        exe("ffmpeg"),
        ["-v", "error", "-ss", t.toFixed(3), "-i", out, "-frames:v", "1", "-vf", `format=rgb24,crop=1:1:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        { encoding: "buffer" },
      );
      return [...(stdout as Buffer)];
    };
    const near = (want: number[]) => (px: number[]) => px.every((v, i) => Math.abs(v - want[i]!) < 24);
    const clipColour = near([0xc0, 0x80, 0x40]);
    const pictureColour = near([0x40, 0xc0, 0xa0]);
    // Full frame: the clip everywhere while it shows, the test picture before.
    expect(clipColour(await pixel((full!.start + full!.end) / 2, 20, 700))).toBe(true);
    expect(clipColour(await pixel(0.1, 20, 700))).toBe(false);
    expect(clipColour(await pixel(full!.end + 0.2, 20, 700))).toBe(false);
    // The round window: the picture in the middle, the recording behind it at its corner.
    const box = overlayBox(pip!, { width: 1280, height: 720 });
    const mid = (pip!.start + pip!.end) / 2;
    expect(pictureColour(await pixel(mid, box.x + box.width / 2, box.y + box.height / 2))).toBe(true);
    expect(pictureColour(await pixel(mid, box.x + 2, box.y + 2))).toBe(false);
    expect(pictureColour(await pixel(pip!.start - 0.3, box.x + box.width / 2, box.y + box.height / 2))).toBe(false);
  }, 180_000);

  it("renders a slide's video once and lays it over the picture, letting the recording through where it is clear", async () => {
    expect(projectId).not.toBe("");
    const s = (await store.get(projectId)).sources[0]!.id;
    await store.update(projectId, null, (q) => {
      q.proposals = q.proposals.filter((x) => !x.overlay);
      const card = { ...slideAsset("sl1", "Half a card", "overlay", 2), slide: { brief: "Half a card", look: "overlay" as const, html: "<p>x</p>" } };
      q.assets.push({ ...card, prep: { preview: "media/assets/sl1/still-2.jpg", frames: [] } });
      q.proposals.push(
        overlayProposal({ id: "o3", sourceId: s, wordIds: [], reason: "", confidence: 1, status: "accepted" }, defaultOverlay([0.3, 1.3], "sl1", "full")),
      );
    });
    // Stands in for the slide renderer: the left half opaque in the clip's colour, the right half clear.
    const renders: string[] = [];
    const renderSlide = async (_: string, asset: { media: { duration: number } }, size: { width: number; height: number }, fps: number, out: string) => {
      renders.push(out);
      await run(exe("ffmpeg"), [
        "-hide_banner", "-y", "-f", "lavfi", "-i", `color=c=black:s=${size.width}x${size.height}:r=${fps}:d=${asset.media.duration}`,
        "-vf", "format=rgba,geq=r=192:g=128:b=64:a='if(lt(X,W/2),255,0)'", "-c:v", "png", "-pix_fmt", "rgba", "-f", "mov", out,
      ]);
    };
    const deps = {
      store,
      queue: new JobQueue(() => {}),
      changed: () => {},
      ffmpeg: (args: string[], { cwd, duration, ctx }: { cwd: string; duration: number; ctx: { signal: AbortSignal } }) =>
        runFfmpeg(exe("ffmpeg"), args, { cwd, duration, signal: ctx.signal }),
      encoder: sw,
      fontsDir: join(__dirname, "..", "..", "resources", "fonts"),
      sfxDir: join(__dirname, "..", "..", "resources", "sfx"),
      renderSlide,
    };
    const out = join(root, "slide.mp4");
    const ctx = { signal: new AbortController().signal, progress: () => {} };
    await new ExportRunner(deps).run(projectId, "16:9", out, ctx);
    await new ExportRunner(deps).run(projectId, "16:9", out, ctx);
    expect(renders).toHaveLength(1);
    expect(renders[0]).toMatch(/media[\\/]assets[\\/]sl1[\\/]render-1280x720-\d+-[0-9a-f]{12}\.mov\.partial\.mov$/);

    const q = await store.get(projectId);
    const [card] = timedOverlays(q, buildTimeline(q));
    const mid = (card!.start + card!.end) / 2;
    const pixel = async (t: number, x: number, y: number) => {
      const { stdout } = await promisify(execFile)(
        exe("ffmpeg"),
        ["-v", "error", "-ss", t.toFixed(3), "-i", out, "-frames:v", "1", "-vf", `format=rgb24,crop=1:1:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        { encoding: "buffer" },
      );
      return [...(stdout as Buffer)];
    };
    const cardColour = (px: number[]) => px.every((v, i) => Math.abs(v - [0xc0, 0x80, 0x40][i]!) < 24);
    expect(cardColour(await pixel(mid, 100, 360))).toBe(true);
    expect(cardColour(await pixel(mid, 1180, 360))).toBe(false);
    expect(cardColour(await pixel(card!.end + 0.3, 100, 360))).toBe(false);
  }, 180_000);

  it("mixes a sound effect and ducked music under the speech", async () => {
    expect(projectId).not.toBe("");
    const s = (await store.get(projectId)).sources[0]!.id;
    await store.update(projectId, null, (q) => {
      q.proposals = q.proposals.filter((x) => !x.overlay);
      q.proposals.push(soundProposal({ id: "fx1", sourceId: s, wordIds: [], reason: "", confidence: 1, status: "accepted" }, { at: 0.5, effect: "boom", volume: 1 }));
      // A title and two chapters, so the joined file carries them.
      q.suggestedTitle = "Tones";
      const ws = [...q.transcript].sort((a, b) => a.start - b.start);
      q.writeup = { chapters: [{ wordId: ws[0]!.id, title: "First" }, { wordId: ws.at(-1)!.id, title: "Second" }], description: "", article: { title: "", markdown: "" } };
    });
    // A high tone the recording doesn't have, so the music is easy to hear in the export.
    const song = join(root, "song.flac");
    await run(exe("ffmpeg"), ["-hide_banner", "-y", "-f", "lavfi", "-i", "sine=f=2000:d=2.5,volume=0.8", "-ac", "2", song]);
    const events: JobEvent[] = [];
    const music = new MusicPipeline({ ...realMusicDeps({ ffmpeg: exe("ffmpeg"), ffprobe: exe("ffprobe") }), store, queue: new JobQueue((e) => events.push(e)), changed: () => {} });
    await music.set(projectId, song);
    for (let i = 0; i < 200 && !events.some((e) => e.state === "done" || e.state === "failed"); i++) await new Promise((r) => setTimeout(r, 50));
    const q = await store.get(projectId);
    expect(q.music).toMatchObject({ name: "song.flac", duck: true });
    expect(q.music!.duration).toBeCloseTo(2.5, 1);
    expect((await stat(join(store.dir(projectId), q.music!.prep!))).size).toBeGreaterThan(1000);

    const deps = {
      store,
      queue: new JobQueue(() => {}),
      changed: () => {},
      ffmpeg: (args: string[], { cwd, duration, ctx }: { cwd: string; duration: number; ctx: { signal: AbortSignal } }) =>
        runFfmpeg(exe("ffmpeg"), args, { cwd, duration, signal: ctx.signal }),
      encoder: sw,
      fontsDir: join(__dirname, "..", "..", "resources", "fonts"),
      sfxDir: join(__dirname, "..", "..", "resources", "sfx"),
    };
    const out = join(root, "sound.mp4");
    await new ExportRunner(deps).run(projectId, "16:9", out, { signal: new AbortController().signal, progress: () => {} });
    const streams = await streamDurations(out);
    expect(Math.abs(streams.video - streams.audio)).toBeLessThan(0.05);
    const { stdout: meta } = await run(exe("ffprobe"), ["-v", "error", "-show_chapters", "-show_entries", "format_tags=title", "-of", "json", out]);
    const probed = JSON.parse(meta) as { chapters: { start_time: string; tags: { title: string } }[]; format: { tags?: { title?: string } } };
    expect(probed.format.tags?.title).toBe("Tones");
    expect(probed.chapters.map((c) => c.tags.title)).toEqual(["First", "Second"]);
    expect(Number(probed.chapters[0]!.start_time)).toBe(0);

    /** The loudest moment, in dB, of one band of a stretch of a file's sound. */
    const peak = async (file: string, from: number, to: number, band: string) => {
      const { stderr } = await run(exe("ffmpeg"), ["-hide_banner", "-ss", from.toFixed(3), "-to", to.toFixed(3), "-i", file, "-vn", "-af", `${band},volumedetect`, "-f", "null", "-"]);
      return Number(/max_volume: (-?[\d.]+|-inf) dB/.exec(stderr)?.[1] ?? Number.NEGATIVE_INFINITY);
    };
    const [boom] = timedSounds(q, buildTimeline(q));
    const plain = join(root, "wide.mp4");
    // The boom's low thump at its moment, and the music past the end of its file, looped.
    expect((await peak(out, boom!.time, boom!.time + 0.4, "lowpass=f=120")) - (await peak(plain, boom!.time, boom!.time + 0.4, "lowpass=f=120"))).toBeGreaterThan(12);
    expect((await peak(out, 2.6, 3.0, "highpass=f=1500")) - (await peak(plain, 2.6, 3.0, "highpass=f=1500"))).toBeGreaterThan(12);
  }, 180_000);

  it("grabs the thumbnail's frame from the original recording, full size", async () => {
    expect(projectId).not.toBe("");
    const s = (await store.get(projectId)).sources[0]!.id;
    const queue = new JobQueue(() => {});
    const pictures: Buffer[] = [];
    const thumbnail = new ThumbnailPipeline({
      ...realThumbnailDeps({ ffmpeg: exe("ffmpeg") }),
      // The cutout runs in the app's hidden window; here it passes the frame through.
      cutout: async (picture) => {
        pictures.push(picture);
        return { png: picture, coverage: 0.4 };
      },
      store,
      queue,
      changed: () => {},
    });
    await thumbnail.pick(projectId, s, 2);
    await queue.idle(projectId);
    const t = (await store.get(projectId)).thumbnail!;
    expect(t.subject).not.toBeNull();
    const { stdout } = await run(exe("ffprobe"), ["-v", "error", "-show_entries", "stream=width,height,codec_name", "-of", "json", join(store.dir(projectId), t.frame)]);
    expect(JSON.parse(stdout).streams[0]).toEqual({ codec_name: "mjpeg", width: 1280, height: 720 });
    expect(pictures[0]![0]).toBe(0xff);
  }, 60_000);
});
