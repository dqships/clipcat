// The real tools behind the import pipeline: bundled ffmpeg, ffprobe and
// whisper-cli, and the speech model in the app's data folder.

import { availableParallelism } from "node:os";
import type { JobContext } from "../jobs/queue";
import { type Encoder, prepArgs } from "../media/prep";
import { probe } from "../media/probe";
import { runFfmpeg } from "../media/run";
import { readWav } from "../media/wav";
import { MODELS, type ModelFile, type ModelId, VAD_MODEL, downloadModel, hasModel, modelPath } from "../transcribe/models";
import { runWhisper, whisperArgs } from "../transcribe/whisper";
import type { PipelineDeps } from "./import";

export type Tools = { ffmpeg: string; ffprobe: string; whisper: string; modelsDir: string; model: ModelId; encoder: Encoder };

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
      try {
        await pass(tools.encoder);
      } catch (e) {
        // A hardware encoder can be missing or busy; the software one always works, just slower.
        if (tools.encoder === "libx264" || ctx.signal.aborted) throw e;
        ctx.progress(0);
        await pass("libx264");
      }
    },
    ensureModel: async (ctx: JobContext) => {
      const fetchOnce = async (model: ModelFile, what: string) => {
        if (await hasModel(tools.modelsDir, model)) return;
        ctx.progress(0, `Downloading ${what} (${model.approxMB} MB, once)`);
        await downloadModel(tools.modelsDir, model, (f) => ctx.progress(f), ctx.signal);
      };
      const speech = MODELS[tools.model];
      await fetchOnce(speech, "the speech model");
      await fetchOnce(VAD_MODEL, "the voice detector");
      return { model: tools.model, path: modelPath(tools.modelsDir, speech), vad: modelPath(tools.modelsDir, VAD_MODEL) };
    },
    transcribe: (opts, ctx) =>
      runWhisper({
        binary: tools.whisper,
        args: whisperArgs({ ...opts, threads: threads() }),
        outBase: opts.outBase,
        onProgress: (f) => ctx.progress(f),
        signal: ctx.signal,
      }),
    readWav,
  };
}
