// The speech models on this computer, for Settings: which are downloaded and
// how big, downloading one ahead of the first transcription, and deleting one
// to free the space. Models aren't kept in memory between transcriptions;
// each run of whisper-cli or clipcat-parakeet loads its model and lets go of
// it when it exits.

import { rm } from "node:fs/promises";
import type { SpeechModelIdValue, SpeechModelValue } from "@clipcat/ipc";
import { MODELS, type ModelId, diskBytes, downloadModel, modelPath, removeModel } from "./models";
import { downloadParakeet, parakeetDir } from "./parakeet";

/** Parakeet's CoreML files, downloaded and compiled by the helper. */
const PARAKEET_MB = 480;

export type SpeechLibraryOpts = {
  modelsDir: string;
  /** clipcat-parakeet, or null where ClipCat doesn't use it. */
  parakeet: string | null;
  onProgress: (id: SpeechModelIdValue, fraction: number | null) => void;
};

export class SpeechLibrary {
  private readonly downloads = new Map<SpeechModelIdValue, Promise<void>>();

  constructor(private readonly opts: SpeechLibraryOpts) {}

  private ids(): SpeechModelIdValue[] {
    return [...(this.opts.parakeet ? (["parakeet"] as const) : []), ...(Object.keys(MODELS) as ModelId[])];
  }

  private path(id: SpeechModelIdValue): string {
    return id === "parakeet" ? parakeetDir(this.opts.modelsDir) : modelPath(this.opts.modelsDir, id);
  }

  async list(): Promise<SpeechModelValue[]> {
    return Promise.all(
      this.ids().map(async (id) => {
        const bytes = this.downloads.has(id) ? 0 : await diskBytes(this.path(id));
        const label = id === "parakeet" ? "Parakeet v3 (Apple Silicon, 25 European languages)" : MODELS[id].label;
        const approxMB = id === "parakeet" ? PARAKEET_MB : MODELS[id].approxMB;
        return { id, label, approxMB, bytes, downloaded: bytes > 1_000_000 };
      }),
    );
  }

  /** Downloads a model; a second call while one is running waits on the same download. */
  download(id: SpeechModelIdValue): Promise<void> {
    if (!this.ids().includes(id)) return Promise.reject(new Error("That speech model isn't used on this computer."));
    const running = this.downloads.get(id);
    if (running) return running;
    const { modelsDir, parakeet, onProgress } = this.opts;
    const signal = new AbortController().signal;
    const work =
      id === "parakeet"
        ? downloadParakeet({
            binary: parakeet!,
            modelsDir,
            onProgress: ({ phase, fraction }) => onProgress(id, phase === "compiling" ? null : fraction),
            signal,
          })
        : downloadModel(modelsDir, id, (f) => onProgress(id, f), signal).then(() => {});
    const done = work.finally(() => this.downloads.delete(id));
    this.downloads.set(id, done);
    return done;
  }

  async remove(id: SpeechModelIdValue): Promise<void> {
    if (this.downloads.has(id)) throw new Error("That model is still downloading.");
    if (id === "parakeet") await rm(parakeetDir(this.opts.modelsDir), { recursive: true, force: true });
    else await removeModel(this.opts.modelsDir, id);
  }
}
