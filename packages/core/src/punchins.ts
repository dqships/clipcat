// Punch-ins: the picture zooms toward the speaker for a few seconds to give a
// line weight. They sit in source time on accepted punch-in proposals, so they
// follow their words through edits, and are timed on the output timeline for
// the export and the preview. They're spaced out, because a zoom only lands
// when the picture has been still for a while.

import { cropOffset, framingAt } from "./framing";
import type { Project, Proposal, PunchStyle, Range, Source, Word } from "./project";
import { type Timeline, buildTimeline } from "./timeline";

export const PUNCH = {
  /** Output seconds from one punch-in's start to the next one's. */
  gap: 10,
  /** Output seconds without a zoom between two punch-ins. */
  rest: 6,
  /** Source seconds a punch-in may last. */
  min: 1.5,
  max: 8,
  /** Seconds a zoom-in takes to push in. */
  ramp: 0.3,
  /** How far down the frame the zoom aims: faces sit in the upper middle. */
  focusY: 0.4,
} as const;

/** How far each style zooms: a snap goes furthest, a slow creep least. */
export const PUNCH_SCALE: Record<PunchStyle, number> = { cut: 1.25, "zoom-in": 1.2, "slow-zoom": 1.15 };

/** An accepted punch-in on the output timeline, from its first kept moment to its last. */
export type TimedPunch = { id: string; sourceId: string; range: Range; style: PunchStyle; scale: number; start: number; end: number };

/** Where a source range plays, from its first kept moment to its last; null if all of it was cut. */
export function outputSpan(timeline: Pick<Timeline, "items" | "speed">, sourceId: string, [a, b]: Range): [number, number] | null {
  const parts = timeline.items.filter((i) => i.sourceId === sourceId && i.sourceStart < b && a < i.sourceEnd);
  if (parts.length === 0) return null;
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  return [
    first.outputStart + (Math.max(a, first.sourceStart) - first.sourceStart) / timeline.speed,
    last.outputStart + (Math.min(b, last.sourceEnd) - last.sourceStart) / timeline.speed,
  ];
}

/** The punch-ins in effect: accepted punch-in proposals, timed on `timeline`, in play order. */
export function timedPunches(project: Pick<Project, "proposals">, timeline: Pick<Timeline, "items" | "speed">): TimedPunch[] {
  const out: TimedPunch[] = [];
  for (const p of project.proposals) {
    if (p.status !== "accepted" || !p.punch) continue;
    const span = outputSpan(timeline, p.sourceId, p.punch.range);
    if (!span || span[1] - span[0] <= 0) continue;
    out.push({ id: p.id, sourceId: p.sourceId, range: p.punch.range, style: p.punch.style, scale: p.punch.scale, start: span[0], end: span[1] });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** How far `punch` has zoomed at output time `t`: 1 outside it. */
export function punchZoom(punch: Pick<TimedPunch, "style" | "scale" | "start" | "end">, t: number): number {
  if (t < punch.start || t >= punch.end) return 1;
  const grown = punch.scale - 1;
  if (punch.style === "cut") return punch.scale;
  if (punch.style === "zoom-in") return 1 + grown * Math.min(1, (t - punch.start) / PUNCH.ramp);
  return 1 + grown * ((t - punch.start) / (punch.end - punch.start));
}

/**
 * Keeps punch-ins that leave room around each other, best first (by `rank`,
 * then earliest): starts at least PUNCH.gap apart and PUNCH.rest without a zoom
 * in between. `fixed` ones (already accepted) always stay and are checked against.
 */
export function spacePunches<T extends { start: number; end: number }>(
  candidates: T[],
  rank: (a: T, b: T) => number,
  fixed: { start: number; end: number }[] = [],
): { kept: T[]; dropped: T[] } {
  const taken = [...fixed];
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const c of [...candidates].sort((a, b) => rank(a, b) || a.start - b.start)) {
    const clear = taken.every((t) => Math.abs(c.start - t.start) >= PUNCH.gap && (c.start >= t.end + PUNCH.rest || c.end + PUNCH.rest <= t.start));
    (clear ? kept : dropped).push(c);
    if (clear) taken.push(c);
  }
  return { kept: kept.sort((a, b) => a.start - b.start), dropped };
}

/**
 * Where a punch-in aims, as fractions of the exported frame: at the speaker
 * during the punch, inside the crop the kept range `item` has. A narrow export
 * crops first, so the speaker's place across the source is moved into the crop.
 */
export function punchFocus(
  source: Pick<Source, "frameX" | "framing" | "faces">,
  item: Range,
  punch: Range,
  srcAspect: number,
  outAspect: number,
): { x: number; y: number } {
  const speaker = framingAt(source, punch[0], punch[1]);
  const width = Math.min(1, outAspect / srcAspect);
  if (width >= 1) return { x: speaker, y: PUNCH.focusY };
  const left = cropOffset(framingAt(source, item[0], item[1]), srcAspect, outAspect) * (1 - width);
  return { x: Math.min(1, Math.max(0, (speaker - left) / width)), y: PUNCH.focusY };
}

/** The source range a punch-in on these words covers: from the first word's start to the last one's end. */
export function punchRange(words: Pick<Word, "start" | "end">[]): Range {
  return [Math.min(...words.map((w) => w.start)), Math.max(...words.map((w) => w.end))];
}

/** A punch-in proposal for `range` of `sourceId`. */
export function punchProposal(
  fields: Pick<Proposal, "id" | "sourceId" | "wordIds" | "reason" | "confidence" | "status">,
  range: Range,
  style: PunchStyle,
): Proposal {
  return { ...fields, type: "punch-in", cuts: [], keepWordIds: [], punch: { range, style, scale: PUNCH_SCALE[style] }, overlay: null, sound: null, music: null };
}

/**
 * Drops proposed punch-ins that crowd each other or the ones already accepted
 * on the project's current edit, least confident first. Errors cite the first
 * word's index in `words`, for the agent's retry.
 */
export function spaceProposedPunches(
  project: Pick<Project, "proposals" | "sources" | "segments" | "speed">,
  proposals: Proposal[],
  words: Pick<Word, "id">[],
): { proposals: Proposal[]; errors: string[] } {
  const timeline = buildTimeline(project);
  const fixed = timedPunches(project, timeline);
  const fresh = proposals.filter((p) => p.punch);
  const timed = timedPunches({ proposals: fresh.map((p) => ({ ...p, status: "accepted" as const })) }, timeline);
  const confidence = new Map(fresh.map((p) => [p.id, p.confidence]));
  const { dropped } = spacePunches(timed, (a, b) => (confidence.get(b.id) ?? 0) - (confidence.get(a.id) ?? 0), fixed);
  const out = new Set(dropped.map((d) => d.id));
  const errors = fresh
    .filter((p) => out.has(p.id))
    .map((p) => `punch-in at word ${words.findIndex((w) => w.id === p.wordIds[0])}: too close to another punch-in (keep starts ${PUNCH.gap} s apart with ${PUNCH.rest} s between), dropped`);
  return { proposals: proposals.filter((p) => !out.has(p.id)), errors };
}
