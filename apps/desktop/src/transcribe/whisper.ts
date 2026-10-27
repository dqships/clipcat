// Local transcription with whisper.cpp's `whisper-cli`. Each word becomes its
// own segment (`-ml 1 -sow`), so the JSON output already carries word-level
// times; we only glue punctuation and sub-word pieces back onto their word.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { Word } from "@clipcat/core";

export type WhisperSegment = { offsets: { from: number; to: number }; text: string };
export type WhisperJson = { transcription?: WhisperSegment[] };

export function whisperArgs(opts: { model: string; wav: string; outBase: string; language: string; threads: number }): string[] {
  return [
    "-m", opts.model,
    "-f", opts.wav,
    "-l", opts.language,
    "-t", String(opts.threads),
    "-ml", "1",
    "-sow",
    "-oj",
    "-of", opts.outBase,
    "-pp",
    "-np",
  ];
}

const NOISE = /^\s*[[(].*[\])]\s*$/; // [BLANK_AUDIO], (music), [ Silence ]

/**
 * Words from whisper-cli JSON. A piece that doesn't start with a space joins
 * the word before it ("don" + "'t", "end" + "."). Times are in seconds.
 */
export function parseWhisper(json: WhisperJson, sourceId: string): Omit<Word, "id">[] {
  const words: Omit<Word, "id">[] = [];
  for (const seg of json.transcription ?? []) {
    const raw = seg.text;
    if (!raw.trim() || NOISE.test(raw)) continue;
    const start = seg.offsets.from / 1000;
    const end = seg.offsets.to / 1000;
    const last = words[words.length - 1];
    if (last && !/^\s/.test(raw)) {
      last.text += raw.trim();
      last.end = Math.max(last.end, end);
    } else {
      words.push({ sourceId, text: raw.trim(), start, end: Math.max(end, start) });
    }
  }
  return words;
}

/** Fraction done from a whisper-cli progress line on stderr. */
export function whisperProgress(line: string): number | null {
  const m = /progress\s*=\s*(\d+)%/.exec(line);
  return m ? Number(m[1]) / 100 : null;
}

export type RunWhisper = {
  binary: string;
  args: string[];
  outBase: string;
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
};

/** Runs whisper-cli and returns its parsed JSON. */
export function runWhisper({ binary, args, outBase, onProgress, signal }: RunWhisper): Promise<WhisperJson> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let tail = "";
    const abort = () => child.kill();
    signal.addEventListener("abort", abort, { once: true });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      tail = (tail + chunk).slice(-4000);
      for (const line of chunk.split(/\r?\n/)) {
        const p = whisperProgress(line);
        if (p !== null) onProgress(p);
      }
    });
    child.on("error", reject);
    child.on("close", async (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) return reject(new Error("cancelled"));
      if (code !== 0) return reject(new Error(`whisper-cli exited with ${code}: ${tail.trim().split("\n").slice(-3).join(" ")}`));
      try {
        resolve(JSON.parse(await readFile(`${outBase}.json`, "utf8")) as WhisperJson);
      } catch (e) {
        reject(e);
      }
    });
  });
}
