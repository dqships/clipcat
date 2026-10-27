import { buildTimeline } from "@clipcat/core";
import { describe, expect, it } from "vitest";
import { nextKept, previewOffset } from "./Preview";

const seg = (id: string, sourceId: string, sourceStart: number, sourceEnd: number, included = true) => ({ id, sourceId, sourceStart, sourceEnd, included });
const sources = [
  { id: "a", order: 0 },
  { id: "b", order: 1 },
] as never;
const timeline = buildTimeline({
  sources,
  speed: 1,
  segments: [seg("1", "a", 0, 2), seg("2", "a", 2, 5, false), seg("3", "a", 5, 8), seg("4", "b", 0, 1, false), seg("5", "b", 1, 4)],
});
const order = new Map([
  ["a", 0],
  ["b", 1],
]);

describe("nextKept", () => {
  it("jumps over a cut within a recording", () => {
    expect(nextKept(timeline, "a", 2, order)).toMatchObject({ sourceId: "a", sourceStart: 5 });
  });

  it("moves on to the next recording past its leading cut", () => {
    expect(nextKept(timeline, "a", 8, order)).toMatchObject({ sourceId: "b", sourceStart: 1 });
  });

  it("is null at the end of the edit", () => {
    expect(nextKept(timeline, "b", 4, order)).toBeNull();
  });
});

describe("previewOffset", () => {
  const faces = { framing: "auto", frameX: 0.5, media: { width: 1920, height: 1080 } } as const;
  const a = { ...faces, id: "a", faces: [{ t: 0.5, x: 0.2 }, { t: 6, x: 0.8 }] } as never;

  it("puts the crop where the export does for the kept range at the playhead", () => {
    // 9:16 of a 16:9 frame is 0.316 of its width; a face at 0.8 puts its left edge at 0.642, 94% of the way it can move.
    expect(previewOffset(timeline, a, 6.5)).toBeCloseTo((0.8 - 0.31640625 / 2) / (1 - 0.31640625), 4);
    expect(previewOffset(timeline, a, 1)).toBeCloseTo((0.2 - 0.31640625 / 2) / (1 - 0.31640625), 4);
  });

  it("follows a hand-set position everywhere", () => {
    const manual = { ...faces, id: "a", framing: "manual", frameX: 0, faces: [{ t: 6, x: 0.8 }] } as never;
    expect(previewOffset(timeline, manual, 6)).toBe(0);
  });
});
