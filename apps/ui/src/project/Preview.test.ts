import { buildTimeline } from "@clipcat/core";
import { describe, expect, it } from "vitest";
import { nextKept } from "./Preview";

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
