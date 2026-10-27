// Import: probe each file, add it to a project, then queue the work that makes
// it editable. For every source that is prep (proxy, audio, thumbnails,
// waveform), transcription (word timings) and silence analysis, in that order
// on the project's queue. Each step saves its result as soon as it has one, so
// a crash or a cancel loses only the step that was running, and `resume`
// picks up whatever is missing.

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
  type MediaInfo,
  type Project,
  type Source,
  detectSilence,
  frameLevels,
  initialSegments,
  silenceProposals,
} from "@clipcat/core";
import type { JobContext, JobQueue } from "../jobs/queue";
import type { PrepOutputs } from "../media/prep";
import type { Pcm } from "../media/wav";
import type { ProjectStore } from "../store/projects";
import type { WhisperJson } from "../transcribe/whisper";
import { parseWhisper } from "../transcribe/whisper";

/** The outside world the pipeline needs; main wires in ffmpeg and whisper, tests wire in fakes. */
export type PipelineDeps = {
  store: ProjectStore;
  queue: JobQueue;
  probe: (file: string) => Promise<MediaInfo>;
  prep: (input: string, media: MediaInfo, out: PrepOutputs, ctx: JobContext) => Promise<void>;
  /** Makes sure a speech model is on disk (downloading it if needed) and returns its name and path. */
  ensureModel: (ctx: JobContext) => Promise<{ model: string; path: string }>;
  transcribe: (opts: { model: string; wav: string; outBase: string; language: string }, ctx: JobContext) => Promise<WhisperJson>;
  readWav: (path: string) => Promise<Pcm>;
  changed: (project: Project) => void;
};

/** Prepared files, relative to the project folder so a project can be moved. */
export function prepPaths(sourceId: string): PrepOutputs {
  const dir = `media/${sourceId}`;
  return { proxy: `${dir}/proxy.mp4`, wav: `${dir}/audio.wav`, waveform: `${dir}/waveform.png`, thumbs: `${dir}/thumb-%04d.jpg` };
}

const shortId = () => randomUUID().slice(0, 8);

export class ImportPipeline {
  constructor(private readonly deps: PipelineDeps) {}

  /**
   * Adds `files` to a project (a new one, named after the first file, when
   * `projectId` is null) and queues their processing. Files are probed first,
   * so a file ClipCat can't use is refused before anything is written.
   */
  async import(files: string[], projectId: string | null): Promise<Project> {
    if (files.length === 0) throw new Error("No files to import");
    const probed = await Promise.all(
      files.map(async (path) => {
        try {
          return { path, media: await this.deps.probe(path) };
        } catch (e) {
          throw new Error(`${basename(path)}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }),
    );
    const { store } = this.deps;
    const first = files[0]!;
    const target = projectId ?? (await store.create(basename(first, extname(first)))).id;
    const added: string[] = [];
    const project = await store.update(target, null, (p) => {
      let order = p.sources.reduce((n, s) => Math.max(n, s.order + 1), 0);
      for (const { path, media } of probed) {
        const id = `s${shortId()}`;
        const source: Source = {
          id,
          name: basename(path),
          path,
          order: order++,
          media,
          frameX: 0.5,
          prep: null,
          transcription: null,
          silenceRanges: [],
        };
        p.sources.push(source);
        p.segments.push(...initialSegments(id, media.duration, () => `g${shortId()}`));
        added.push(id);
      }
    });
    await store.log(project.id, { type: "imported", files: probed.map((f) => f.path) });
    this.deps.changed(project);
    for (const s of project.sources.filter((x) => added.includes(x.id))) {
      this.enqueue(project.id, s, { prep: true, transcribe: true, silence: true });
    }
    return project;
  }

  /** Re-queues whatever an earlier run left unfinished, for every project. */
  async resume(): Promise<void> {
    for (const summary of await this.deps.store.list()) {
      const p = await this.deps.store.get(summary.id);
      for (const s of p.sources) {
        const prep = s.prep === null;
        const transcribe = s.transcription === null;
        if (prep || transcribe) this.enqueue(p.id, s, { prep, transcribe, silence: true });
      }
    }
  }

  /** Runs transcription and silence analysis again, e.g. after changing the language. */
  async retranscribe(projectId: string, sourceId: string): Promise<void> {
    const source = await this.source(projectId, sourceId);
    if (source) this.enqueue(projectId, source, { prep: false, transcribe: true, silence: true });
  }

  private enqueue(projectId: string, source: Pick<Source, "id" | "name">, steps: { prep: boolean; transcribe: boolean; silence: boolean }): void {
    const { queue } = this.deps;
    const { id, name } = source;
    // A failed step is reported by the queue; the next step decides for itself whether it can still run.
    const swallow = () => {};
    if (steps.prep) queue.add(projectId, "prep", `Preparing ${name}`, (ctx) => this.runPrep(projectId, id, ctx)).catch(swallow);
    if (steps.transcribe) queue.add(projectId, "transcribe", `Transcribing ${name}`, (ctx) => this.runTranscribe(projectId, id, ctx)).catch(swallow);
    if (steps.silence) queue.add(projectId, "silence", `Finding pauses in ${name}`, () => this.runSilence(projectId, id)).catch(swallow);
  }

  private async source(projectId: string, sourceId: string): Promise<Source | undefined> {
    return (await this.deps.store.get(projectId)).sources.find((s) => s.id === sourceId);
  }

  private abs(projectId: string, rel: string): string {
    return join(this.deps.store.dir(projectId), rel);
  }

  private async save(projectId: string, change: (p: Project) => void): Promise<void> {
    this.deps.changed(await this.deps.store.update(projectId, null, change));
  }

  async runPrep(projectId: string, sourceId: string, ctx: JobContext): Promise<void> {
    const source = await this.source(projectId, sourceId);
    if (!source) return; // removed while queued
    await mkdir(this.deps.store.mediaDir(projectId, sourceId), { recursive: true });
    const rel = prepPaths(sourceId);
    const abs: PrepOutputs = {
      proxy: this.abs(projectId, rel.proxy),
      wav: this.abs(projectId, rel.wav),
      waveform: this.abs(projectId, rel.waveform),
      thumbs: this.abs(projectId, rel.thumbs),
    };
    await this.deps.prep(source.path, source.media, abs, ctx);
    await this.save(projectId, (p) => {
      const s = p.sources.find((x) => x.id === sourceId);
      if (s) s.prep = rel;
    });
  }

  async runTranscribe(projectId: string, sourceId: string, ctx: JobContext): Promise<void> {
    const project = await this.deps.store.get(projectId);
    const source = project.sources.find((s) => s.id === sourceId);
    if (!source?.prep) return; // prep failed or the source is gone; nothing to listen to
    const { model, path } = await this.deps.ensureModel(ctx);
    ctx.progress(0, `Transcribing ${source.name}`);
    const json = await this.deps.transcribe(
      {
        model: path,
        wav: this.abs(projectId, source.prep.wav),
        outBase: join(this.deps.store.mediaDir(projectId, sourceId), "transcript"),
        language: project.language,
      },
      ctx,
    );
    const words = parseWhisper(json, sourceId).map((w, i) => ({ ...w, id: `${sourceId}-${i}` }));
    await this.save(projectId, (p) => {
      const s = p.sources.find((x) => x.id === sourceId);
      if (!s) return;
      s.transcription = { backend: "whisper.cpp", model };
      const order = new Map(p.sources.map((x) => [x.id, x.order]));
      p.transcript = [...p.transcript.filter((w) => w.sourceId !== sourceId), ...words].sort(
        (a, b) => (order.get(a.sourceId) ?? 0) - (order.get(b.sourceId) ?? 0) || a.start - b.start,
      );
    });
  }

  async runSilence(projectId: string, sourceId: string): Promise<void> {
    const project = await this.deps.store.get(projectId);
    const source = project.sources.find((s) => s.id === sourceId);
    if (!source?.prep) return;
    const pcm = await this.deps.readWav(this.abs(projectId, source.prep.wav));
    const words = project.transcript.filter((w) => w.sourceId === sourceId);
    const ranges = detectSilence(frameLevels(pcm.samples, pcm.sampleRate), words);
    await this.save(projectId, (p) => {
      const s = p.sources.find((x) => x.id === sourceId);
      if (!s) return;
      s.silenceRanges = ranges;
      // Fresh silence proposals replace pending ones; ones the user already decided on stay.
      p.proposals = [
        ...p.proposals.filter((x) => !(x.type === "silence" && x.sourceId === sourceId && x.status === "pending")),
        ...silenceProposals(sourceId, ranges, words, s.media.duration, () => `x${shortId()}`).filter(
          (np) =>
            !p.proposals.some(
              (old) => old.type === "silence" && old.sourceId === sourceId && old.status !== "pending" && overlaps(old.cuts, np.cuts),
            ),
        ),
      ];
    });
  }
}

function overlaps(a: [number, number][], b: [number, number][]): boolean {
  return a.some(([a0, a1]) => b.some(([b0, b1]) => a0 < b1 && b0 < a1));
}
