// Export: render the edit to an MP4 with captions burned in, and an SRT of
// the same captions beside it. The work happens in the project's export/
// folder, where ffmpeg runs with the captions, their fonts and the filter
// graph under short relative names, so no path needs escaping in the graph.

import { copyFile, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { type Project, buildTimeline, captionCues, outputWords, toAss, toSrt } from "@clipcat/core";
import type { JobContext, JobQueue } from "../jobs/queue";
import { type ExportFormat, exportCommand, exportSize } from "../media/export";
import type { Encoder } from "../media/prep";
import type { ProjectStore } from "../store/projects";

export type ExportDeps = {
  store: ProjectStore;
  queue: JobQueue;
  changed: (project: Project) => void;
  /** Runs ffmpeg in `cwd`, reporting progress through `duration` seconds of output. */
  ffmpeg: (args: string[], opts: { cwd: string; duration: number; ctx: JobContext }) => Promise<void>;
  encoder: Encoder;
  /** The bundled caption fonts. */
  fontsDir: string;
};

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
    const timeline = buildTimeline(project);
    const size = exportSize(format, project.sources);
    const work = join(store.dir(projectId), "export");
    await rm(work, { recursive: true, force: true });
    await mkdir(join(work, "fonts"), { recursive: true });

    const cues = captionCues(outputWords(project, timeline), project.captions.mode, size);
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
    // Rendered beside the target under a temporary name, so a failed export never leaves half a file under the real one.
    const partial = join(dirname(out), `.${basename(out, extname(out))}.clipcat-partial.mp4`);
    const render = async (encoder: Encoder) => {
      const { graph, args } = exportCommand({ project, timeline, format, inputs, captions, encoder, graphFile: "graph.txt", out: partial });
      await writeFile(join(work, "graph.txt"), graph);
      await this.deps.ffmpeg(args, { cwd: work, duration: timeline.duration, ctx });
    };
    try {
      try {
        await render(this.deps.encoder);
      } catch (e) {
        // As in prep: a hardware encoder can be missing or busy, and libx264 always works.
        if (this.deps.encoder === "libx264" || ctx.signal.aborted) throw e;
        ctx.progress(0, `Exporting ${format} (software encoder)`);
        await render("libx264");
      }
      await rename(partial, out);
    } catch (e) {
      await rm(partial, { force: true });
      throw e;
    }
    if (cues.length > 0) await writeFile(srtPath(out), toSrt(cues, project.captions.case));
    await rm(work, { recursive: true, force: true });

    const updated = await store.update(projectId, null, (p) => {
      p.lastExport = { path: out, format, at: new Date().toISOString() };
    });
    await store.log(projectId, { type: "exported", format, path: out, seconds: timeline.duration, cues: cues.length });
    this.deps.changed(updated);
  }
}
