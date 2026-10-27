// The real tools behind the import pipeline: bundled ffmpeg, ffprobe,
// clipcat-parakeet (Apple Silicon) and whisper-cli, and the speech models in
// the app's data folder. Parakeet hears the languages it knows; whisper hears
// the rest, and takes over whenever Parakeet can't run.

import { writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import type { Encoder } from "../media/encoders";
import { type FaceDetector, findFaces } from "../media/faces";
import { prepArgs } from "../media/prep";
import { probe } from "../media/probe";
import { runFfmpeg } from "../media/run";
import { encodeWav, readWav } from "../media/wav";
import { MODELS, type ModelId, downloadModel, hasModel, modelPath } from "../transcribe/models";
import { PARAKEET_LANGUAGES, PARAKEET_MODEL, runParakeet } from "../transcribe/parakeet";
import { runWhisper, termsPrompt, whisperArgs } from "../transcribe/whisper";
import type { Heard, PipelineDeps } from "./import";

export type Tools = {
  ffmpeg: string;
  ffprobe: string;
  whisper: string;
  /** clipcat-parakeet, or null where it isn't bundled (anything but Apple Silicon) or is turned off. */
  parakeet: string | null;
  modelsDir: string;
  model: ModelId;
  /** The H.264 encoder to try first (probed once); libx264 is the fallback. */
  encoder: () => Promise<Encoder>;
  /** The user's names and terms, passed to whisper as its initial prompt. */
  dictionary?: () => Promise<string[]>;
  /** The system's face detector, or null where there is none. */
  faceDetector?: () => Promise<FaceDetector | null>;
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
    transcribe: async (opts, ctx) => {
      let fallback: string | undefined;
      if (tools.parakeet && PARAKEET_LANGUAGES.has(opts.language)) {
        try {
          const json = await runParakeet({
            binary: tools.parakeet,
            modelsDir: tools.modelsDir,
            wav: opts.wav,
            outBase: opts.outBase,
            onProgress: ({ phase, fraction }) => {
              if (phase === "downloading") ctx.progress(fraction, "Downloading the speech model (once)");
              else if (phase === "compiling") ctx.progress(null, "Preparing the speech model");
              else ctx.progress(fraction, opts.label);
            },
            signal: ctx.signal,
          });
          return { json, backend: "parakeet", model: PARAKEET_MODEL };
        } catch (e) {
          // An older macOS, a failed download or a broken model: whisper still works, just slower.
          if (ctx.signal.aborted) throw e;
          fallback = e instanceof Error ? e.message : String(e);
          ctx.progress(0, opts.label);
        }
      }
      if (!(await hasModel(tools.modelsDir, tools.model))) {
        ctx.progress(0, `Downloading the speech model (${MODELS[tools.model].approxMB} MB, once)`);
        await downloadModel(tools.modelsDir, tools.model, (f) => ctx.progress(f), ctx.signal);
        ctx.progress(0, opts.label);
      }
      const json = await runWhisper({
        binary: tools.whisper,
        args: whisperArgs({
          model: modelPath(tools.modelsDir, tools.model),
          wav: opts.wav,
          outBase: opts.outBase,
          language: opts.language,
          threads: threads(),
          prompt: termsPrompt((await tools.dictionary?.()) ?? []),
        }),
        outBase: opts.outBase,
        onProgress: (f) => ctx.progress(f),
        signal: ctx.signal,
      });
      return { json, backend: "whisper.cpp", model: tools.model, ...(fallback ? { fallback } : {}) } satisfies Heard;
    },
    faces: async ({ proxy, duration, dir }, ctx) => {
      const detect = (await tools.faceDetector?.()) ?? null;
      if (!detect) return null;
      return findFaces({ ffmpeg: tools.ffmpeg, proxy, duration, dir, detect, ctx });
    },
    readWav,
    writeWav: (path, pcm) => writeFile(path, encodeWav(pcm.samples, pcm.sampleRate)),
  };
}
