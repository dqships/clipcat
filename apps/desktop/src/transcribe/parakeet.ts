// Local transcription with NVIDIA's Parakeet TDT 0.6B v3 on Apple Silicon,
// through `clipcat-parakeet` (native/parakeet, a small Swift helper around
// FluidAudio that runs the model on the Neural Engine). It is several times
// faster than whisper on an M-series Mac and times words more tightly. The
// model downloads into the models folder on the first run.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WhisperJson } from "./whisper";

export const PARAKEET_MODEL = "parakeet-tdt-0.6b-v3";

/** The languages Parakeet v3 was trained on (it finds which one by itself). Everything else goes to whisper. */
export const PARAKEET_LANGUAGES = new Set([
  "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hr", "hu", "it",
  "lt", "lv", "mt", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "uk",
]);

/** Where the helper keeps its models, inside the app's models folder. */
export const parakeetDir = (modelsDir: string): string => join(modelsDir, "parakeet");

export function parakeetArgs(opts: { modelsDir: string; wav: string; out: string }): string[] {
  return ["transcribe", "--models", parakeetDir(opts.modelsDir), "--input", opts.wav, "--output", opts.out];
}

export type ParakeetJson = { model: string; text: string; words: { text: string; start: number; end: number }[] };

/** The helper's words as whisper-style segments (each starts a word; times in ms), so one parser reads both. */
export function parakeetSegments(json: ParakeetJson): WhisperJson {
  return {
    transcription: json.words
      .filter((w) => w.text.trim())
      .map((w) => ({ offsets: { from: Math.round(w.start * 1000), to: Math.round(Math.max(w.start, w.end) * 1000) }, text: ` ${w.text.trim()}` })),
  };
}

export type ParakeetProgress = { phase: "downloading" | "compiling" | "transcribing" | "ready"; fraction: number };

/** A `phase=<name> progress=<0..1>` line from the helper. */
export function parakeetProgress(line: string): ParakeetProgress | null {
  const m = /^phase=(downloading|compiling|transcribing|ready) progress=([\d.]+)$/.exec(line.trim());
  return m ? { phase: m[1] as ParakeetProgress["phase"], fraction: Math.min(1, Number(m[2])) } : null;
}

export type RunParakeet = {
  binary: string;
  modelsDir: string;
  wav: string;
  outBase: string;
  onProgress: (p: ParakeetProgress) => void;
  signal: AbortSignal;
};

/** Runs the helper and returns its words as whisper-style JSON. */
export function runParakeet({ binary, modelsDir, wav, outBase, onProgress, signal }: RunParakeet): Promise<WhisperJson> {
  const out = `${outBase}.parakeet.json`;
  return new Promise((resolve, reject) => {
    const child = spawn(binary, parakeetArgs({ modelsDir, wav, out }), { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    let partial = "";
    const abort = () => child.kill();
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const lines = (partial + chunk).split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const line of lines) {
        const p = parakeetProgress(line);
        if (p) onProgress(p);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      tail = (tail + chunk).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", async (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) return reject(new Error("cancelled"));
      if (code !== 0) return reject(new Error(`clipcat-parakeet exited with ${code}: ${tail.trim().split("\n").slice(-3).join(" ")}`));
      try {
        resolve(parakeetSegments(JSON.parse(await readFile(out, "utf8")) as ParakeetJson));
      } catch (e) {
        reject(e);
      }
    });
  });
}
