// The real tools behind the import pipeline: bundled ffmpeg, ffprobe and
// whisper-cli, and the speech model in the app's data folder.

import { writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import type { JobContext } from "../jobs/queue";
import type { Encoder } from "../media/encoders";
import { prepArgs } from "../media/prep";
import { probe } from "../media/probe";
import { runFfmpeg } from "../media/run";
import { encodeWav, readWav } from "../media/wav";
import { MODELS, type ModelId, downloadModel, hasModel, modelPath } from "../transcribe/models";
import { runWhisper, termsPrompt, whisperArgs } from "../transcribe/whisper";
import type { PipelineDeps } from "./import";

export type Tools = {
  ffmpeg: string;
  ffprobe: string;
  whisper: string;
  modelsDir: string;
  model: ModelId;
  /** The H.264 encoder to try first (probed once); libx264 is the fallback. */
  encoder: () => Promise<Encoder>;
  /** The user's names and terms, passed to whisper as its initial prompt. */
  dictionary?: () => Promise<string[]>;
};

/** Leaves a couple of cores for the UI and the preview. */
const threads = () => Math.max(1, Math.min(8, availableParallelism() - 2));

export function realDeps(tools: Tools): Omit<PipelineDeps, "store" | "queue" | "changed"> {
  return {
    probe: (file) => probe(tools.ffprobe, file),
    prep: async (input, media, out, ctx) => {
      const pass = (encoder: Encoder) =>
        runFfmpeg(tools.ffmpeg, prepArgs(input, media, out, encoder), {
          duration: media.duration,
          onProgress: (f) => ctx.progress(f),
          signal: ctx.signal,
        });
      const encoder = await tools.encoder();
      try {
        await pass(encoder);
      } catch (e) {
        // A hardware encoder can be missing or busy; the software one always works, just slower.
        if (encoder === "libx264" || ctx.signal.aborted) throw e;
        ctx.progress(0);
        await pass("libx264");
      }
    },
    ensureModel: async (ctx: JobContext) => {
      if (!(await hasModel(tools.modelsDir, tools.model))) {
        ctx.progress(0, `Downloading the speech model (${MODELS[tools.model].approxMB} MB, once)`);
        await downloadModel(tools.modelsDir, tools.model, (f) => ctx.progress(f), ctx.signal);
      }
      return { model: tools.model, path: modelPath(tools.modelsDir, tools.model) };
    },
    transcribe: async (opts, ctx) =>
      runWhisper({
        binary: tools.whisper,
        args: whisperArgs({ ...opts, threads: threads(), prompt: termsPrompt((await tools.dictionary?.()) ?? []) }),
        outBase: opts.outBase,
        onProgress: (f) => ctx.progress(f),
        signal: ctx.signal,
      }),
    readWav,
    writeWav: (path, pcm) => writeFile(path, encodeWav(pcm.samples, pcm.sampleRate)),
  };
}
