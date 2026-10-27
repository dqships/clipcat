// Export: render the edit to an MP4 with captions burned in, and an SRT of
// the same captions beside it. The work happens in the project's export/
// folder, where ffmpeg runs with the captions, their fonts, the filter graphs
// and the chunks under short relative names, so no path needs escaping. Long
// videos render a few minutes at a time (see media/export.ts), and a cancel
// stops whichever ffmpeg is running.

import { copyFile, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { type Project, buildTimeline, captionCues, outputWords, timedPunches, toAss, toSrt } from "@clipcat/core";
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
  muxArgs,
} from "../media/export";
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
  /** Output seconds per video chunk; tests make it small. */
  chunkSeconds?: number;
};

/** Shares of the progress bar: the sound pass and the join are quick next to the picture. */
const AUDIO_SHARE = 0.05;
const MUX_SHARE = 0.03;

/** "/v/talk.mp4" → "/v/talk.srt". */
export const srtPath = (out: string) => join(dirname(out), `${basename(out, extname(out))}.srt`);

export class ExportRunner {
  constructor(private readonly deps: ExportDeps) {}

  /** Queues an export after whatever the project is already doing. */
  export(projectId: string, format: ExportFormat, out: string): void {
    this.deps.queue.add(projectId, "export", `Exporting ${format}`, (ctx) => this.run(projectId, format, out, ctx)).catch(() => {});
  }

  async run(projectId: string, format: ExportFormat, out: string, ctx: JobContext): Promise<void> {
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
    const done = { cues: 0, chunks: 0, encoder: "libx264" as Encoder };
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

      const inputs = new Map(
        project.sources.map((s) => [s.id, s.media.videoCodec || !s.prep ? s.path : join(store.dir(projectId), s.prep.proxy)]),
      );
      const shape = { project, punches: timedPunches(project, timeline), format, fps, inputs, graphFile: "graph.txt" };
      const ffmpeg = async ({ graph, args }: { graph: string; args: string[] }, duration: number, from: number, to: number) => {
        await writeFile(join(work, "graph.txt"), graph);
        const part = { signal: ctx.signal, progress: (f: number | null, label?: string) => ctx.progress(from + (f ?? 0) * (to - from), label) };
        await this.deps.ffmpeg(args, { cwd: work, duration, ctx: part });
      };

      // Sound first (quick), then the picture chunk by chunk, then the join.
      await ffmpeg(audioCommand({ ...shape, timeline, out: "audio.m4a" }), timeline.duration, 0, AUDIO_SHARE);
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

      // Joined beside the target under a temporary name, so a failed export never leaves half a file under the real one.
      const partial = join(dirname(out), `.${basename(out, extname(out))}.clipcat-partial.mp4`);
      try {
        await this.deps.ffmpeg(muxArgs("chunks.txt", "audio.m4a", partial), {
          cwd: work,
          duration: timeline.duration,
          ctx: { signal: ctx.signal, progress: (f) => ctx.progress(1 - MUX_SHARE + (f ?? 0) * MUX_SHARE) },
        });
        await rename(partial, out);
      } catch (e) {
        await rm(partial, { force: true });
        throw e;
      }
      if (cues.length > 0) await writeFile(srtPath(out), toSrt(cues, project.captions.case));
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
