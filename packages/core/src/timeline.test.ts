import { describe, expect, it } from "vitest";
import { initialSegments, setRange } from "./edits";
import { counter, source } from "./fixtures";
import { buildTimeline, outputToSource, sourceToOutput } from "./timeline";

describe("buildTimeline", () => {
  const id = counter("s");
  const sources = [source("b", 10, 1), source("a", 5, 0)];
  let segments = [...initialSegments("a", 5, id), ...initialSegments("b", 10, id)];
  segments = setRange(segments, "a", [1, 2], false, id);
  segments = setRange(segments, "b", [4, 6], false, id);

  it("orders by source order then time and skips cut ranges", () => {
    const t = buildTimeline({ sources, segments, speed: 1 });
    expect(t.items.map((i) => [i.sourceId, i.sourceStart, i.sourceEnd])).toEqual([
      ["a", 0, 1],
      ["a", 2, 5],
      ["b", 0, 4],
      ["b", 6, 10],
    ]);
    expect(t.duration).toBeCloseTo(12);
  });

  it("divides by speed", () => {
    expect(buildTimeline({ sources, segments, speed: 2 }).duration).toBeCloseTo(6);
  });

  it("maps source to output and back", () => {
    for (const speed of [0.5, 1, 1.5, 2]) {
      const t = buildTimeline({ sources, segments, speed });
      for (const [sourceId, time] of [["a", 0.5], ["a", 3], ["b", 1], ["b", 9.9]] as const) {
        const out = sourceToOutput(t, sourceId, time);
        expect(out).not.toBeNull();
        expect(outputToSource(t, out!)).toEqual({ sourceId, time: expect.closeTo(time, 9) });
      }
      expect(sourceToOutput(t, "a", 1.5)).toBeNull();
      expect(sourceToOutput(t, "b", 5)).toBeNull();
    }
  });

  it("keeps output times contiguous", () => {
    const t = buildTimeline({ sources, segments, speed: 1.25 });
    t.items.forEach((item, i) => {
      if (i > 0) expect(item.outputStart).toBeCloseTo(t.items[i - 1]!.outputEnd);
    });
  });
});
