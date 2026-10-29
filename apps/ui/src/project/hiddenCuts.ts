import type { Segment } from "@clipcat/core";
import { useCallback, useState } from "react";

/** A stretch of one recording, in seconds. */
export type Range = [start: number, end: number];

/** What's left of `[0, duration]` once `cuts` are taken out, in order. */
export function keptRanges(cuts: Pick<Segment, "sourceStart" | "sourceEnd">[], duration: number): Range[] {
  const sorted = [...cuts].sort((a, b) => a.sourceStart - b.sourceStart);
  const kept: Range[] = [];
  let at = 0;
  for (const c of sorted) {
    if (c.sourceStart > at) kept.push([at, Math.min(c.sourceStart, duration)]);
    at = Math.max(at, c.sourceEnd);
    if (at >= duration) break;
  }
  if (at < duration) kept.push([at, duration]);
  return kept.filter(([a, b]) => b > a);
}

const total = (kept: Range[]) => kept.reduce((sum, [a, b]) => sum + b - a, 0);

/** Where `time` lands on a strip with the cuts closed up, 0 to 1. A moment inside a cut sits where the cut was. */
export function toStrip(kept: Range[], time: number): number {
  const length = total(kept);
  if (length <= 0) return 0;
  let before = 0;
  for (const [a, b] of kept) {
    if (time < a) break;
    before += Math.min(time, b) - a;
  }
  return before / length;
}

/** The recording time under `x` (0 to 1) on a strip with the cuts closed up. */
export function fromStrip(kept: Range[], x: number): number {
  let left = Math.min(1, Math.max(0, x)) * total(kept);
  for (const [a, b] of kept) {
    if (left <= b - a) return a + left;
    left -= b - a;
  }
  return kept.at(-1)?.[1] ?? 0;
}

/** The parts of `range` that are kept: what's left of a suggestion once the cuts are hidden. */
export function keptParts(kept: Range[], [start, end]: Range): Range[] {
  return kept.map(([a, b]): Range => [Math.max(a, start), Math.min(b, end)]).filter(([a, b]) => b > a);
}

const KEY = "clipcat.hideCuts";

// Storage can be missing or throw; the switch still works, it just isn't remembered.
function load(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether cut words and stretches are hidden from the transcript and the strip, remembered across projects and launches. */
export function useHideCuts(): [boolean, () => void] {
  const [hidden, setHidden] = useState(load);
  const toggle = useCallback(() => {
    setHidden((was) => {
      try {
        localStorage.setItem(KEY, was ? "0" : "1");
      } catch {
        // Not remembered this time.
      }
      return !was;
    });
  }, []);
  return [hidden, toggle];
}
