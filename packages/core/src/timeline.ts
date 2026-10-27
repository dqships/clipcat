// The output timeline, derived from the project: included segments in source
// order, laid end to end and divided by speed. Never stored, so it can't drift
// from the segments it comes from.

import type { Project, Segment } from "./project";

export type TimelineItem = {
  segmentId: string;
  sourceId: string;
  sourceStart: number;
  sourceEnd: number;
  outputStart: number;
  outputEnd: number;
};

export type Timeline = { items: TimelineItem[]; duration: number; speed: number };

/** Segments shorter than this are dropped from the output: they can't hold a frame. */
export const MIN_SEGMENT = 1 / 60;

export function buildTimeline(project: Pick<Project, "sources" | "segments" | "speed">): Timeline {
  const order = new Map(project.sources.map((s) => [s.id, s.order]));
  const kept = project.segments
    .filter((s) => s.included && s.sourceEnd - s.sourceStart >= MIN_SEGMENT && order.has(s.sourceId))
    .sort(
      (a, b) =>
        (order.get(a.sourceId) ?? 0) - (order.get(b.sourceId) ?? 0) || a.sourceStart - b.sourceStart,
    );

  const speed = project.speed;
  const items: TimelineItem[] = [];
  let t = 0;
  for (const seg of kept) {
    const length = (seg.sourceEnd - seg.sourceStart) / speed;
    items.push({
      segmentId: seg.id,
      sourceId: seg.sourceId,
      sourceStart: seg.sourceStart,
      sourceEnd: seg.sourceEnd,
      outputStart: t,
      outputEnd: t + length,
    });
    t += length;
  }
  return { items, duration: t, speed };
}

/** Where a source moment lands in the output, or null if it was cut. */
export function sourceToOutput(timeline: Timeline, sourceId: string, t: number): number | null {
  for (const item of timeline.items) {
    if (item.sourceId === sourceId && t >= item.sourceStart && t < item.sourceEnd) {
      return item.outputStart + (t - item.sourceStart) / timeline.speed;
    }
  }
  return null;
}

/** Which source moment plays at output time `t`; clamps to the ends. */
export function outputToSource(timeline: Timeline, t: number): { sourceId: string; time: number } | null {
  const { items } = timeline;
  if (items.length === 0) return null;
  const first = items[0]!;
  if (t <= first.outputStart) return { sourceId: first.sourceId, time: first.sourceStart };
  for (const item of items) {
    if (t < item.outputEnd) return { sourceId: item.sourceId, time: item.sourceStart + (t - item.outputStart) * timeline.speed };
  }
  const last = items[items.length - 1]!;
  return { sourceId: last.sourceId, time: last.sourceEnd };
}

export type { Segment };
