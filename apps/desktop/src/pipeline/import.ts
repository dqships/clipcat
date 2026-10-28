// Import: probe each file, add it to a project, then queue the work that makes
// it editable. For every source that is prep (proxy, audio, thumbnails,
// waveform), transcription (word timings), silence analysis and finding the
// speaker's face (for the vertical crop), in that order on the project's queue. Each step saves its result as soon as it has one, so
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
  fromSpeechTime,
  initialSegments,
  quietRanges,
  replacePending,
  silenceProposals,
  speechSpans,
  trimStretchedWords,
} from "@clipcat/core";
import type { JobContext, JobQueue } from "../jobs/queue";
import type { PrepOutputs } from "../media/prep";
import type { Pcm } from "../media/wav";
import type { ProjectStore } from "../store/projects";
import type { WhisperJson } from "../transcribe/whisper";
import { parseWhisper } from "../transcribe/whisper";

/** What heard the speech: its words (as whisper-style JSON), the engine and model, and why a faster engine was passed over. */
export type Heard = { json: WhisperJson; backend: string; model: string; fallback?: string };

/** The outside world the pipeline needs; main wires in ffmpeg, Parakeet and whisper, tests wire in fakes. */
export type PipelineDeps = {
  store: ProjectStore;
  queue: JobQueue;
  probe: (file: string) => Promise<MediaInfo>;
  prep: (input: string, media: MediaInfo, out: PrepOutputs, ctx: JobContext) => Promise<void>;
  /**
   * Hears the speech in `wav`, downloading a speech model on first use. `label`
   * is the job's own label, shown again once a download is done.
   */
  transcribe: (opts: { wav: string; outBase: string; language: string; label: string }, ctx: JobContext) => Promise<Heard>;
  /** The speaker's centre (0..1 across) every few seconds of `proxy`; null when the face detector can't run. */
  faces: (opts: { proxy: string; duration: number; dir: string }, ctx: JobContext) => Promise<{ t: number; x: number }[] | null>;
  readWav: (path: string) => Promise<Pcm>;
  writeWav: (path: string, pcm: Pcm) => Promise<void>;
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
    if (files.length === 0) throw new Error("Choose at least one video to import.");
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
          framing: "auto",
          faces: null,
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
      this.enqueue(project.id, s, { prep: true, transcribe: true, silence: true, faces: true });
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
        const faces = s.faces === null;
        if (prep || transcribe) this.enqueue(p.id, s, { prep, transcribe, silence: true, faces });
        else if (faces) this.enqueue(p.id, s, { prep, transcribe, silence: false, faces });
      }
    }
  }

  /** Runs transcription and silence analysis again, e.g. after changing the language. */
  async retranscribe(projectId: string, sourceId: string): Promise<void> {
    const source = await this.source(projectId, sourceId);
    if (source) this.enqueue(projectId, source, { prep: false, transcribe: true, silence: true, faces: false });
  }

  private enqueue(
    projectId: string,
    source: Pick<Source, "id" | "name">,
    steps: { prep: boolean; transcribe: boolean; silence: boolean; faces: boolean },
  ): void {
    const { queue } = this.deps;
    const { id, name } = source;
    // A failed step is reported by the queue; the next step decides for itself whether it can still run.
    const swallow = () => {};
    if (steps.prep) queue.add(projectId, "prep", `Preparing ${name}`, (ctx) => this.runPrep(projectId, id, ctx)).catch(swallow);
    if (steps.transcribe) queue.add(projectId, "transcribe", `Transcribing ${name}`, (ctx) => this.runTranscribe(projectId, id, ctx)).catch(swallow);
    if (steps.silence) queue.add(projectId, "silence", `Finding pauses in ${name}`, () => this.runSilence(projectId, id)).catch(swallow);
    if (steps.faces) queue.add(projectId, "faces", `Finding the speaker in ${name}`, (ctx) => this.runFaces(projectId, id, ctx)).catch(swallow);
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
    // The speech engine hears the speech with long pauses taken out, then its times are mapped back.
    const dir = this.deps.store.mediaDir(projectId, sourceId);
    const pcm = await this.deps.readWav(this.abs(projectId, source.prep.wav));
    const spans = speechSpans(quietRanges(frameLevels(pcm.samples, pcm.sampleRate)), pcm.samples.length / pcm.sampleRate);
    const parts = spans.map(([a, b]) => pcm.samples.subarray(Math.round(a * pcm.sampleRate), Math.round(b * pcm.sampleRate)));
    const speech = new Float32Array(parts.reduce((n, x) => n + x.length, 0));
    parts.reduce((at, x) => (speech.set(x, at), at + x.length), 0);
    const speechWav = join(dir, "speech.wav");
    await this.deps.writeWav(speechWav, { sampleRate: pcm.sampleRate, samples: speech });
    const heard = await this.deps.transcribe(
      { wav: speechWav, outBase: join(dir, "transcript"), language: project.language, label: `Transcribing ${source.name}` },
      ctx,
    );
    const words = parseWhisper(heard.json, sourceId).map((w, i) => {
      const start = fromSpeechTime(w.start, spans, "start");
      return { ...w, id: `${sourceId}-${i}`, start, end: Math.max(start, fromSpeechTime(w.end, spans, "end")) };
    });
    await this.save(projectId, (p) => {
      const s = p.sources.find((x) => x.id === sourceId);
      if (!s) return;
      s.transcription = { backend: heard.backend, model: heard.model };
      const order = new Map(p.sources.map((x) => [x.id, x.order]));
      p.transcript = [...p.transcript.filter((w) => w.sourceId !== sourceId), ...words].sort(
        (a, b) => (order.get(a.sourceId) ?? 0) - (order.get(b.sourceId) ?? 0) || a.start - b.start,
      );
    });
    const { backend, model, fallback } = heard;
    await this.deps.store.log(projectId, { type: "transcribed", source: sourceId, backend, model, words: words.length, ...(fallback ? { fallback } : {}) });
  }

  async runSilence(projectId: string, sourceId: string): Promise<void> {
    const project = await this.deps.store.get(projectId);
    const source = project.sources.find((s) => s.id === sourceId);
    if (!source?.prep) return;
    const pcm = await this.deps.readWav(this.abs(projectId, source.prep.wav));
    const levels = frameLevels(pcm.samples, pcm.sampleRate);
    const words = trimStretchedWords(
      project.transcript.filter((w) => w.sourceId === sourceId),
      quietRanges(levels),
    );
    const fixed = new Map(words.map((w) => [w.id, w]));
    const ranges = detectSilence(levels, words);
    await this.save(projectId, (p) => {
      const s = p.sources.find((x) => x.id === sourceId);
      if (!s) return;
      p.transcript = p.transcript.map((w) => fixed.get(w.id) ?? w);
      s.silenceRanges = ranges;
      // Fresh silence proposals replace pending ones; ones the user already decided on stay.
      p.proposals = replacePending(
        p.proposals,
        silenceProposals(sourceId, ranges, words, s.media.duration, () => `x${shortId()}`),
        (x) => x.type === "silence" && x.sourceId === sourceId,
      );
    });
  }

  async runFaces(projectId: string, sourceId: string, ctx: JobContext): Promise<void> {
    const source = await this.source(projectId, sourceId);
    if (!source?.prep) return;
    // A recording with no picture (audio only, shown as a still) has no one to follow.
    const faces =
      source.media.width > 0
        ? await this.deps.faces(
            { proxy: this.abs(projectId, source.prep.proxy), duration: source.media.duration, dir: this.deps.store.mediaDir(projectId, sourceId) },
            ctx,
          )
        : [];
    // No detector: leave it unknown, and the crop stays where it's set.
    if (faces === null) return void (await this.deps.store.log(projectId, { type: "faces", source: sourceId, found: null }));
    await this.save(projectId, (p) => {
      const s = p.sources.find((x) => x.id === sourceId);
      if (s) s.faces = faces;
    });
    await this.deps.store.log(projectId, { type: "faces", source: sourceId, found: faces.length });
  }
}
