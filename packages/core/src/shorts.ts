// Shorts: the AI editor picks stretches of a long video that stand on their
// own, and each becomes its own vertical project. The agent cites word ranges
// like it does for cuts; they are checked against the real words, and a short
// only keeps what the long edit keeps, so accepted cuts carry over.

import { z } from "zod";
import { mergeNeighbours } from "./edits";
import type { Project, Range, Segment, Source, Word } from "./project";

export const AgentShort = z.object({
  title: z.string().min(1).max(100),
  /** Why it works on its own: the hook and the payoff, for the user. */
  reason: z.string().min(1).max(400),
  /** Word ranges (inclusive indices) played in order; a short may skip a stretch in the middle. */
  ranges: z.array(z.object({ from: z.number().int(), to: z.number().int() })).min(1).max(4),
});

export const AgentShorts = z.object({ shorts: z.array(AgentShort).max(20) });

export type AgentShort = z.infer<typeof AgentShort>;
export type AgentShorts = z.infer<typeof AgentShorts>;

export const SHORT_SECONDS = [30, 60, 90] as const;
export type ShortSeconds = (typeof SHORT_SECONDS)[number];

/** A checked short: its source ranges (already cut down to what the long edit keeps) and its length. */
export type ShortPlan = {
  title: string;
  reason: string;
  /** Source ranges in play order. */
  keep: { sourceId: string; range: Range }[];
  seconds: number;
};

/** A short shorter than this isn't worth its own project. */
const MIN_SECONDS = 5;
/** Room past the asked length: a sentence may end a little late. */
const OVER = 1.15;
/** Lead-in before a short's first word and tail after its last, at most. */
const LEAD = 0.2;
const TAIL = 0.35;

/**
 * Where a short starts and ends in source time: just before its first word
 * and just after its last, never reaching into the neighbouring words.
 */
function wordsRange(local: Word[], from: number, to: number, duration: number): Range {
  const first = local[from]!;
  const last = local[to]!;
  const prev = local[from - 1];
  const next = local[to + 1];
  const start = Math.max(prev ? (prev.end + first.start) / 2 : 0, first.start - LEAD, 0);
  const end = Math.min(next ? (last.end + next.start) / 2 : duration, last.end + TAIL, duration);
  return [start, end];
}

/** The parts of `range` the edit keeps. */
export function keptParts(segments: Segment[], sourceId: string, range: Range): Range[] {
  return segments
    .filter((s) => s.sourceId === sourceId && s.included && s.sourceEnd > range[0] && s.sourceStart < range[1])
    .sort((a, b) => a.sourceStart - b.sourceStart)
    .map((s): Range => [Math.max(s.sourceStart, range[0]), Math.min(s.sourceEnd, range[1])])
    .filter(([a, b]) => b - a > 1e-6);
}

/**
 * Checks the agent's shorts against `words` (the numbered transcript, all
 * sources in order) and the long edit's `segments`. At most `count` are kept,
 * each between 5 s and a little over `seconds` once the edit's cuts are taken
 * out.
 */
export function validateShorts(
  answer: AgentShorts,
  words: Word[],
  sources: Pick<Source, "id" | "media">[],
  segments: Segment[],
  limits: { count: number; seconds: number },
): { shorts: ShortPlan[]; errors: string[] } {
  const errors: string[] = [];
  const shorts: ShortPlan[] = [];
  const durations = new Map(sources.map((s) => [s.id, s.media.duration]));

  answer.shorts.forEach((short, index) => {
    const where = `short ${index} ("${short.title}")`;
    if (shorts.length >= limits.count) {
      errors.push(`${where}: only ${limits.count} ${limits.count === 1 ? "short was" : "shorts were"} asked for, dropped`);
      return;
    }
    const keep: ShortPlan["keep"] = [];
    let last = -1;
    for (const { from, to } of short.ranges) {
      if (from < 0 || to >= words.length || from > to) {
        errors.push(`${where}: range ${from}..${to}: word indices must satisfy 0 <= from <= to < ${words.length}`);
        return;
      }
      if (from <= last) {
        errors.push(`${where}: range ${from}..${to}: ranges must be in order and must not overlap`);
        return;
      }
      last = to;
      const sourceId = words[from]!.sourceId;
      if (words[to]!.sourceId !== sourceId) {
        errors.push(`${where}: range ${from}..${to}: a range must stay inside one recording`);
        return;
      }
      const local = words.filter((w) => w.sourceId === sourceId);
      const offset = words.indexOf(local[0]!);
      const range = wordsRange(local, from - offset, to - offset, durations.get(sourceId) ?? local[local.length - 1]!.end);
      for (const part of keptParts(segments, sourceId, range)) keep.push({ sourceId, range: part });
    }
    const seconds = keep.reduce((n, k) => n + k.range[1] - k.range[0], 0);
    if (seconds < MIN_SECONDS) {
      errors.push(`${where}: ${seconds.toFixed(1)} s once the cuts are taken out; a short needs at least ${MIN_SECONDS} s`);
      return;
    }
    if (seconds > limits.seconds * OVER) {
      errors.push(`${where}: ${seconds.toFixed(1)} s is too long; keep it under ${limits.seconds} s`);
      return;
    }
    if (shorts.some((s) => sameKeep(s.keep, keep))) {
      errors.push(`${where}: the same as an earlier short, dropped`);
      return;
    }
    shorts.push({ title: short.title.trim(), reason: short.reason.trim(), keep, seconds });
  });
  return { shorts, errors };
}

const sameKeep = (a: ShortPlan["keep"], b: ShortPlan["keep"]) =>
  a.length === b.length && a.every((k, i) => k.sourceId === b[i]!.sourceId && Math.abs(k.range[0] - b[i]!.range[0]) < 0.01 && Math.abs(k.range[1] - b[i]!.range[1]) < 0.01);

/**
 * The short's edit: each source it uses starts fully cut, with its kept
 * ranges included. Sources it doesn't use are left out of the short.
 */
export function shortSegments(plan: ShortPlan, duration: (sourceId: string) => number, id: () => string): Segment[] {
  const segments: Segment[] = [];
  for (const sourceId of new Set(plan.keep.map((k) => k.sourceId))) {
    const ranges = plan.keep.filter((k) => k.sourceId === sourceId).map((k) => k.range).sort((a, b) => a[0] - b[0]);
    let at = 0;
    for (const [a, b] of ranges) {
      if (a > at) segments.push({ id: id(), sourceId, sourceStart: at, sourceEnd: a, included: false });
      segments.push({ id: id(), sourceId, sourceStart: a, sourceEnd: b, included: true });
      at = b;
    }
    const end = duration(sourceId);
    if (end > at) segments.push({ id: id(), sourceId, sourceStart: at, sourceEnd: end, included: false });
  }
  return mergeNeighbours(segments);
}

/** The source ranges a proposal is about: what it cuts, or where it zooms or shows b-roll. */
const proposalRanges = (p: Project["proposals"][number]): Range[] => [
  ...p.cuts,
  ...(p.punch ? [p.punch.range] : []),
  ...(p.overlay ? [p.overlay.range] : []),
  ...(p.sound ? [[p.sound.at, p.sound.at] as Range] : []),
];

/**
 * The short as a project of its own, vertical, with the recordings it uses
 * (their prepared media are shared with `parent`), all their words, the
 * parent's b-roll media, and the suggestions still waiting that fall inside it.
 */
export function shortProject(parent: Project, plan: ShortPlan, opts: { id: string; now: string; segmentId: () => string }): Project {
  const used = new Set(plan.keep.map((k) => k.sourceId));
  const sources = [...parent.sources]
    .filter((s) => used.has(s.id))
    .sort((a, b) => a.order - b.order)
    .map((s, order) => ({ ...structuredClone(s), order }));
  const duration = (id: string) => sources.find((s) => s.id === id)?.media.duration ?? 0;
  const segments = shortSegments(plan, duration, opts.segmentId);
  const inside = (sourceId: string, [a, b]: Range) => {
    const kept = keptParts(segments, sourceId, [a, b]);
    return kept.length === 1 && Math.abs(kept[0]![0] - a) < 1e-6 && Math.abs(kept[0]![1] - b) < 1e-6;
  };
  return {
    version: 1,
    id: opts.id,
    name: plan.title,
    language: parent.language,
    aspectRatio: "9:16",
    speed: parent.speed,
    revision: 0,
    brief: "",
    suggestedTitle: plan.title,
    sources,
    assets: parent.assets.map((a) => structuredClone(a)),
    // Music is picked for a whole video; a short gets its own.
    music: null,
    writeup: null,
    thumbnail: null,
    transcript: parent.transcript.filter((w) => used.has(w.sourceId)).map((w) => ({ ...w })),
    segments,
    proposals: parent.proposals
      .filter((p) => p.status === "pending" && used.has(p.sourceId) && proposalRanges(p).every((c) => inside(p.sourceId, c)))
      .map((p) => structuredClone(p)),
    captions: { ...parent.captions },
    history: { past: [], future: [] },
    lastExport: null,
    origin: { projectId: parent.id, name: parent.name, reason: plan.reason },
    shorts: [],
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}
