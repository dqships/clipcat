// Finds pauses from the audio itself, so silence cuts don't depend on the
// transcript being right. Levels are measured in 20 ms frames; the threshold
// adapts to each recording's room noise and speaking level.

import type { Proposal, Range, Word } from "./project";

export const FRAME_SECONDS = 0.02;
/** Pauses longer than this are proposed as cuts. */
export const GAP_MIN = 1.15;
/** Audio kept on each side of a cut pause, so speech doesn't start abruptly. */
export const HANDLE = 0.12;
/** Shortest run of quiet frames that counts as silence at all. */
export const SILENCE_MIN = 0.3;
/** Below this level a room is quiet no matter what the statistics say. */
export const ROOM_QUIET_DB = -60;

/** Level of each 20 ms frame in dBFS. Samples are mono floats in -1..1. */
export function frameLevels(samples: Float32Array, sampleRate: number): Float32Array {
  const size = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const count = Math.floor(samples.length / size);
  const levels = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    let sum = 0;
    for (let i = f * size; i < (f + 1) * size; i++) sum += samples[i]! * samples[i]!;
    const rms = Math.sqrt(sum / size);
    levels[f] = rms > 0 ? 20 * Math.log10(rms) : -120;
  }
  return levels;
}

function percentile(values: Float32Array, p: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? -120;
}

/** The level under which a frame is silent: max(min(-42, speech - 24, floor + 12), room quiet). */
export function silenceThreshold(levels: Float32Array): number {
  if (levels.length === 0) return ROOM_QUIET_DB;
  const floor = percentile(levels, 0.1);
  const speech = percentile(levels, 0.9);
  return Math.max(Math.min(-42, speech - 24, floor + 12), ROOM_QUIET_DB);
}

/** Silent stretches in seconds, never covering a transcribed word. */
export function detectSilence(levels: Float32Array, words: Pick<Word, "start" | "end">[] = []): Range[] {
  const threshold = silenceThreshold(levels);
  const raw: Range[] = [];
  let start = -1;
  for (let f = 0; f <= levels.length; f++) {
    const quiet = f < levels.length && levels[f]! < threshold;
    if (quiet && start < 0) start = f;
    if (!quiet && start >= 0) {
      raw.push([start * FRAME_SECONDS, f * FRAME_SECONDS]);
      start = -1;
    }
  }
  return protectWords(raw, words).filter(([a, b]) => b - a >= SILENCE_MIN);
}

/** Trims or splits ranges so none overlaps a word: the transcript wins over the meter. */
export function protectWords(ranges: Range[], words: Pick<Word, "start" | "end">[]): Range[] {
  let out = ranges;
  for (const w of words) {
    const next: Range[] = [];
    for (const [a, b] of out) {
      if (w.end <= a || w.start >= b) next.push([a, b]);
      else {
        if (w.start > a) next.push([a, w.start]);
        if (w.end < b) next.push([w.end, b]);
      }
    }
    out = next;
  }
  return out;
}

/**
 * Cut proposals for long pauses, with a handle kept on each side. Silence
 * before the first word and after the last is trimmed to one handle too.
 */
export function silenceProposals(
  sourceId: string,
  ranges: Range[],
  words: Word[],
  duration: number,
  id: () => string,
): Proposal[] {
  const first = words[0];
  const last = words[words.length - 1];
  const proposals: Proposal[] = [];
  for (const [a, b] of ranges) {
    const leading = first ? b <= first.start + 1e-6 : false;
    const trailing = last ? a >= last.end - 1e-6 : false;
    const start = leading && a < 1e-6 ? 0 : a + HANDLE;
    const end = trailing && b > duration - 1e-6 ? duration : b - HANDLE;
    if (!(leading || trailing) && b - a < GAP_MIN) continue;
    if (end - start < FRAME_SECONDS) continue;
    proposals.push({
      id: id(),
      type: "silence",
      sourceId,
      cuts: [[start, end]],
      wordIds: [],
      keepWordIds: [],
      reason: `${(b - a).toFixed(1)} s pause`,
      confidence: 1,
      status: "pending",
    });
  }
  return proposals;
}
