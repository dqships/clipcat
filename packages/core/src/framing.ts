// Framing for narrow exports: where the speaker is across the frame, from
// faces found in frames sampled every couple of seconds, and where the crop
// window goes so they stay in it. The crop moves only at cuts, never inside a
// kept range, so a shot never drifts or jumps while it plays.

import type { Source } from "./project";

/** How far from a range a face sample may be and still count for it. */
const NEAR = 4;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * The speaker's horizontal centre (0..1 of the frame width) for the source
 * range `start..end`: the median face position inside it, else the nearest
 * samples, else the recording's overall median. A position the user set by
 * hand wins over all of them.
 */
export function framingAt(source: Pick<Source, "frameX" | "framing" | "faces">, start: number, end: number): number {
  if (source.framing === "manual" || !source.faces?.length) return source.frameX;
  const inside = source.faces.filter((f) => f.t >= start && f.t <= end).map((f) => f.x);
  if (inside.length) return median(inside);
  const near = source.faces.filter((f) => f.t >= start - NEAR && f.t <= end + NEAR).map((f) => f.x);
  return median(near.length ? near : source.faces.map((f) => f.x));
}

/**
 * Where a crop of shape `outAspect` (width ÷ height) sits in a frame of shape
 * `srcAspect`, as a fraction of the room it has to move (0 = left edge,
 * 1 = right edge), so that `centerX` is in its middle where the edges allow.
 * The same number places ffmpeg's crop and the preview's object-position.
 */
export function cropOffset(centerX: number, srcAspect: number, outAspect: number): number {
  const width = Math.min(1, outAspect / srcAspect);
  if (width >= 1) return 0.5;
  const left = centerX - width / 2;
  return Math.min(1, Math.max(0, left / (1 - width)));
}

/** The face nearest the middle of a frame wins ties; otherwise the biggest face is the speaker. */
export function speakerX(faces: { x: number; y: number; width: number; height: number }[]): number | null {
  if (faces.length === 0) return null;
  const score = (f: (typeof faces)[number]) => f.width * f.height * (1 - 0.5 * Math.abs(f.x + f.width / 2 - 0.5));
  const best = faces.reduce((a, b) => (score(b) > score(a) ? b : a));
  return Math.min(1, Math.max(0, best.x + best.width / 2));
}
