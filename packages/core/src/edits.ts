// Non-destructive edits. A source starts as one included segment; cutting a
// range splits segments at its edges and marks the middle excluded, restoring
// marks it included again. Neighbours with the same state are merged, so the
// list stays as short as the edit allows.

import type { Project, Range, Segment, Word } from "./project";

export type IdFactory = () => string;

/** One included segment covering a whole source. */
export function initialSegments(sourceId: string, duration: number, id: IdFactory): Segment[] {
  return [{ id: id(), sourceId, sourceStart: 0, sourceEnd: duration, included: true }];
}

const EPS = 1e-6;

/** Sets `range` of `sourceId` to `included`, splitting and merging segments as needed. */
export function setRange(segments: Segment[], sourceId: string, range: Range, included: boolean, id: IdFactory): Segment[] {
  const [a, b] = range[0] <= range[1] ? range : [range[1], range[0]];
  if (b - a < EPS) return segments;
  const out: Segment[] = [];
  for (const seg of segments) {
    if (seg.sourceId !== sourceId || seg.sourceEnd <= a + EPS || seg.sourceStart >= b - EPS) {
      out.push(seg);
      continue;
    }
    if (seg.sourceStart < a - EPS) out.push({ ...seg, id: id(), sourceEnd: a });
    out.push({ ...seg, id: id(), sourceStart: Math.max(seg.sourceStart, a), sourceEnd: Math.min(seg.sourceEnd, b), included });
    if (seg.sourceEnd > b + EPS) out.push({ ...seg, id: id(), sourceStart: b });
  }
  return mergeNeighbours(out);
}

export function mergeNeighbours(segments: Segment[]): Segment[] {
  const sorted = [...segments].sort((x, y) => (x.sourceId < y.sourceId ? -1 : x.sourceId > y.sourceId ? 1 : x.sourceStart - y.sourceStart));
  const out: Segment[] = [];
  for (const seg of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.sourceId === seg.sourceId && prev.included === seg.included && Math.abs(prev.sourceEnd - seg.sourceStart) < EPS) {
      out[out.length - 1] = { ...prev, sourceEnd: seg.sourceEnd };
    } else {
      out.push(seg);
    }
  }
  return out;
}

/**
 * The source range removed when words `from..to` (indices into one source's
 * words, inclusive) are cut. It runs from the middle of the gap before the
 * first word to the middle of the gap after the last, so the words on either
 * side keep their natural breath.
 */
export function wordSpanRange(words: Word[], from: number, to: number, sourceDuration: number): Range {
  const first = words[from];
  const last = words[to];
  if (!first || !last || from > to) throw new RangeError(`bad word span ${from}..${to}`);
  const prev = words[from - 1];
  const next = words[to + 1];
  const start = prev ? (prev.end + first.start) / 2 : 0;
  const end = next ? (last.end + next.start) / 2 : sourceDuration;
  return [start, end];
}

/** Whether a word's middle sits inside an included segment. */
export function isWordKept(segments: Segment[], word: Word): boolean {
  const mid = (word.start + word.end) / 2;
  return segments.some((s) => s.sourceId === word.sourceId && s.included && mid >= s.sourceStart && mid < s.sourceEnd);
}

/** Every word, recording by recording in project order, then by time: the order the video plays them and the agents number them. */
export function orderedWords(project: Pick<Project, "sources" | "transcript">): Word[] {
  return [...project.sources]
    .sort((a, b) => a.order - b.order)
    .flatMap((s) => project.transcript.filter((w) => w.sourceId === s.id).sort((a, b) => a.start - b.start));
}
