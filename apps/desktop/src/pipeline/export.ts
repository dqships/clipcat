// Export: render the edit to an MP4 with captions burned in, and an SRT of
// the same captions beside it. The work happens in the project's export/
// folder, where ffmpeg runs with the captions, their fonts, the filter graphs
// and the chunks under short relative names, so no path needs escaping. Long
// videos render a few minutes at a time (see media/export.ts), and a cancel
// stops whichever ffmpeg is running.

import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import {
  type Asset,
  type Project,
  SOUND_EFFECTS,
  buildTimeline,
  captionCues,
  outputWords,
  timedChapters,
  timedOverlays,
  timedPunches,
  timedMusic,
  timedSounds,
  toAss,
  toSrt,
} from "@clipcat/core";
import type { JobContext, JobQueue } from "../jobs/queue";
import type { Encoder } from "../media/encoders";
import {
  CHUNK_SECONDS,
  type ExportFormat,
  audioCommand,
  chunkCommand,
  chunkList,
  exportChunks,
  exportFps,
  exportSize,
  frameTimeline,
  ffmetadata,
  muxArgs,
} from "../media/export";
import { soundFile } from "../sound/library";
import type { ProjectStore } from "../store/projects";

export type ExportDeps = {
  store: ProjectStore;
  queue: JobQueue;
  changed: (project: Project) => void;
  /** Runs ffmpeg in `cwd`, reporting progress through `duration` seconds of output. */
  ffmpeg: (args: string[], opts: { cwd: string; duration: number; ctx: JobContext }) => Promise<void>;
  /** The H.264 encoder to try first (probed once); libx264 is the fallback. */
  encoder: () => Promise<Encoder>;
  /** The bundled caption fonts. */
  fontsDir: string;
  /** The bundled sound effects. */
  sfxDir: string;
  /** Output seconds per video chunk; tests make it small. */
  chunkSeconds?: number;
  /** Renders a slide's video, with transparency, at `out` (absolute). */
  renderSlide?: (projectId: string, asset: Asset, size: { width: number; height: number }, fps: number, out: string, ctx: JobContext) => Promise<void>;
};

/** Where a slide's video for this export shape is kept, relative to the project folder: a new design or shape renders a new one. */
export function slideRender(asset: Pick<Asset, "id" | "slide" | "media">, size: { width: number; height: number }, fps: number): string {
  const hash = createHash("sha256")
    .update(JSON.stringify([asset.slide?.html, asset.slide?.look, asset.media.duration]))
    .digest("hex")
    .slice(0, 12);
  return `media/assets/${asset.id}/render-${size.width}x${size.height}-${fps}-${hash}.mov`;
}

/** Shares of the progress bar: the sound pass and the join are quick next to the picture. */
const AUDIO_SHARE = 0.05;
const MUX_SHARE = 0.03;

const exists = (path: string) => access(path).then(
  () => true,
  () => false,
);

/** "/v/talk.mp4" → "/v/talk.srt". */
export const srtPath = (out: string) => join(dirname(out), `${basename(out, extname(out))}.srt`);

export class ExportRunner {
  constructor(private readonly deps: ExportDeps) {}

  /** Queues an export after whatever the project is already doing; `cover`, a PNG, becomes the file's cover art. */
  export(projectId: string, format: ExportFormat, out: string, cover: Buffer | null = null): void {
    this.deps.queue.add(projectId, "export", `Exporting ${format}`, (ctx) => this.run(projectId, format, out, ctx, cover)).catch(() => {});
  }

  /** The video file of each slide the edit shows, rendering the ones not rendered for this shape yet. */
  private async renderSlides(projectId: string, project: Project, size: { width: number; height: number }, fps: number, ctx: JobContext): Promise<Map<string, string>> {
    const root = this.deps.store.dir(projectId);
    const timeline = buildTimeline(project);
    const shown = [...new Map(timedOverlays(project, timeline).filter((o) => o.asset.kind === "slide").map((o) => [o.asset.id, o.asset])).values()];
    const files = new Map<string, string>();
    for (const [i, asset] of shown.entries()) {
      const rel = slideRender(asset, size, fps);
      const file = join(root, rel);
      if (!(await exists(file))) {
        if (!this.deps.renderSlide) throw new Error("Slides can't be rendered here");
        const label = `Rendering slide ${i + 1} of ${shown.length}`;
        ctx.progress(null, label);
        const dir = dirname(file);
        await mkdir(dir, { recursive: true });
        // An earlier design's or shape's video goes; rendering again is quick.
        for (const old of await readdir(dir)) if (old.startsWith("render-")) await rm(join(dir, old), { force: true });
        const partial = `${file}.partial.mov`;
        try {
          await this.deps.renderSlide(projectId, asset, size, fps, partial, { signal: ctx.signal, progress: (f) => ctx.progress(null, `${label} (${Math.round((f ?? 0) * 100)}%)`) });
          await rename(partial, file);
        } catch (e) {
          await rm(partial, { force: true });
          throw e;
        }
      }
      files.set(asset.id, file);
    }
    return files;
  }

  async run(projectId: string, format: ExportFormat, out: string, ctx: JobContext, cover: Buffer | null = null): Promise<void> {
    const { store } = this.deps;
    const project = await store.get(projectId);
    const fps = exportFps(project.sources);
    const timeline = frameTimeline(buildTimeline(project), fps);
    if (timeline.frames === 0) throw new Error("Nothing is left to export: every part of the video is cut.");
    const size = exportSize(format, project.sources);
    const work = join(store.dir(projectId), "export");
    await rm(work, { recursive: true, force: true });
    await mkdir(join(work, "fonts"), { recursive: true });

    // What the log records once the file is out.
    const done = { cues: 0, chunks: 0, encoder: "libx264" as Encoder, cover: cover !== null };
    try {
      const cues = captionCues(outputWords(project, timeline), project.captions.mode, size);
      done.cues = cues.length;
      let captions: { ass: string; fontsDir: string } | null = null;
      if (project.captions.enabled && cues.length > 0) {
        for (const f of await readdir(this.deps.fontsDir)) {
          if (/\.(ttf|otf)$/i.test(f)) await copyFile(join(this.deps.fontsDir, f), join(work, "fonts", f));
        }
        await writeFile(join(work, "captions.ass"), toAss(cues, project.captions, size));
        captions = { ass: "captions.ass", fontsDir: "fonts" };
      }

      // Slides are rendered once per design and shape, before anything else.
      const slides = await this.renderSlides(projectId, project, size, fps, ctx);

      // Originals that have moved or been deleted, played from the copy made for the preview.
      const moved: string[] = [];
      const present = async (path: string, copy: string | null, name: string) => {
        if (!copy || (await exists(path))) return path;
        moved.push(name);
        return join(store.dir(projectId), copy);
      };
      const inputs = new Map(
        await Promise.all(
          project.sources.map(async (s): Promise<[string, string]> => [s.id, s.media.videoCodec || !s.prep ? await present(s.path, s.prep?.proxy ?? null, s.name) : join(store.dir(projectId), s.prep.proxy)]),
        ),
      );
      // B-roll video is read from the original; a picture from its prepared PNG, which ffmpeg reads whatever the original was.
      const overlayInputs = new Map(
        await Promise.all(
          project.assets.map(async (a): Promise<[string, string]> => [a.id, slides.get(a.id) ?? (a.kind === "video" || !a.prep ? await present(a.path, a.prep?.preview ?? null, a.name) : join(store.dir(projectId), a.prep.preview))]),
        ),
      );
      if (moved.length > 0) ctx.note?.(`${moved.join(", ")} ${moved.length === 1 ? "isn't" : "aren't"} where ${moved.length === 1 ? "it was" : "they were"}, so this export used ClipCat's preview ${moved.length === 1 ? "copy" : "copies"}.`);
      const overlays = timedOverlays(project, timeline);
      const shape = { project, punches: timedPunches(project, timeline), overlays, overlayInputs, format, fps, inputs, graphFile: "graph.txt" };
      const ffmpeg = async ({ graph, args }: { graph: string; args: string[] }, duration: number, from: number, to: number) => {
        await writeFile(join(work, "graph.txt"), graph);
        const part = { signal: ctx.signal, progress: (f: number | null, label?: string) => ctx.progress(from + (f ?? 0) * (to - from), label) };
        await this.deps.ffmpeg(args, { cwd: work, duration, ctx: part });
      };

      // Sound first (quick), with its effects and music, then the picture chunk by chunk, then the join.
      const sounds = {
        cues: timedSounds(project, timeline),
        files: new Map(SOUND_EFFECTS.map((e) => [e.id, soundFile(this.deps.sfxDir, e.id)])),
        hits: new Map(SOUND_EFFECTS.map((e) => [e.id, e.hit])),
      };
      const music = await Promise.all(
        timedMusic(project, timeline).map(async ({ track, start, end, offset, fadeIn, fadeOut }) => ({
          // The original, or the copy made for the preview when the original has moved.
          file: (await exists(track.path)) || !track.prep ? track.path : join(store.dir(projectId), track.prep),
          volume: track.volume,
          duck: track.duck,
          start,
          end,
          offset,
          fadeIn,
          fadeOut,
        })),
      );
      await ffmpeg(audioCommand({ ...shape, timeline, sounds, music, out: "audio.m4a" }), timeline.duration, 0, AUDIO_SHARE);
      const chunks = exportChunks(timeline, Math.max(1, Math.round((this.deps.chunkSeconds ?? CHUNK_SECONDS) * fps)));
      const files = chunks.map((_, i) => `chunk-${String(i).padStart(3, "0")}.mp4`);
      done.chunks = chunks.length;
      const at = (frames: number) => AUDIO_SHARE + (frames / timeline.frames) * (1 - AUDIO_SHARE - MUX_SHARE);
      const render = async (encoder: Encoder) => {
        done.encoder = encoder;
        for (const [i, chunk] of chunks.entries()) {
          const plan = chunkCommand({ ...shape, chunk, captions, encoder, out: files[i]! });
          await ffmpeg(plan, chunk.frames / fps, at(chunk.start), at(chunk.start + chunk.frames));
        }
      };
      const encoder = await this.deps.encoder();
      try {
        await render(encoder);
      } catch (e) {
        // As in prep: a hardware encoder can be missing or busy, and libx264 always works. Every
        // chunk is redone so they all come from one encoder and join cleanly.
        if (encoder === "libx264" || ctx.signal.aborted) throw e;
        ctx.progress(AUDIO_SHARE, `Exporting ${format} (software encoder)`);
        await render("libx264");
      }
      await writeFile(join(work, "chunks.txt"), chunkList(files));
      // The title and chapters go into the file, so players list the chapters.
      const chapters = timedChapters(project, buildTimeline(project)).filter((c) => c.start < timeline.duration);
      const title = project.suggestedTitle.trim();
      if (title || chapters.length > 0) await writeFile(join(work, "meta.txt"), ffmetadata(title, chapters, timeline.duration));
      // The thumbnail goes in as cover art, which players and file browsers show for the video.
      if (cover) await writeFile(join(work, "cover.png"), cover);

      // Joined beside the target under a temporary name, so a failed export never leaves half a file under the real one.
      const partial = join(dirname(out), `.${basename(out, extname(out))}.clipcat-partial.mp4`);
      try {
        await this.deps.ffmpeg(muxArgs("chunks.txt", "audio.m4a", partial, title || chapters.length > 0 ? "meta.txt" : null, cover ? "cover.png" : null), {
          cwd: work,
          duration: timeline.duration,
          ctx: { signal: ctx.signal, progress: (f) => ctx.progress(1 - MUX_SHARE + (f ?? 0) * MUX_SHARE) },
        });
        await rename(partial, out);
      } catch (e) {
        await rm(partial, { force: true });
        throw e;
      }
      // The .srt reads a line at a time, whichever way the burned-in captions appear.
      const lines = project.captions.mode === "sentence" ? cues : captionCues(outputWords(project, timeline), "sentence", size);
      if (lines.length > 0) await writeFile(srtPath(out), toSrt(lines, project.captions.case));
    } finally {
      // The chunks can be gigabytes; they go whether the export finished, failed or was cancelled.
      await rm(work, { recursive: true, force: true });
    }

    const updated = await store.update(projectId, null, (p) => {
      p.lastExport = { path: out, format, at: new Date().toISOString() };
    });
    await store.log(projectId, { type: "exported", format, path: out, seconds: timeline.duration, ...done });
    this.deps.changed(updated);
  }
}
