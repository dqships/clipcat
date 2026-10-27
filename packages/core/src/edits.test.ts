import { describe, expect, it } from "vitest";
import { initialSegments, isWordKept, setRange, wordSpanRange } from "./edits";
import { counter, words } from "./fixtures";

const id = counter();
const total = (segs: { sourceStart: number; sourceEnd: number; included: boolean }[], inc: boolean) =>
  segs.filter((s) => s.included === inc).reduce((n, s) => n + s.sourceEnd - s.sourceStart, 0);

describe("setRange", () => {
  it("cuts and restores back to one segment", () => {
    let segs = initialSegments("a", 10, id);
    segs = setRange(segs, "a", [2, 3], false, id);
    segs = setRange(segs, "a", [5, 7], false, id);
    expect(total(segs, true)).toBeCloseTo(7);
    segs = setRange(segs, "a", [2, 3], true, id);
    segs = setRange(segs, "a", [5, 7], true, id);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ sourceStart: 0, sourceEnd: 10, included: true });
  });

  it("handles overlapping and reversed cuts", () => {
    let segs = initialSegments("a", 10, id);
    segs = setRange(segs, "a", [4, 2], false, id);
    segs = setRange(segs, "a", [3, 6], false, id);
    expect(segs.filter((s) => !s.included)).toHaveLength(1);
    expect(total(segs, false)).toBeCloseTo(4);
  });

  it("never touches another source", () => {
    const segs = setRange([...initialSegments("a", 5, id), ...initialSegments("b", 5, id)], "a", [0, 5], false, id);
    expect(segs.find((s) => s.sourceId === "b")).toMatchObject({ included: true, sourceStart: 0, sourceEnd: 5 });
  });

  it("covers the source exactly after many random edits", () => {
    let segs = initialSegments("a", 60, id);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 60;
    for (let i = 0; i < 300; i++) segs = setRange(segs, "a", [rnd(), rnd()], i % 3 !== 0, id);
    expect(total(segs, true) + total(segs, false)).toBeCloseTo(60);
    segs.forEach((s, i) => {
      if (i > 0) expect(s.sourceStart).toBeCloseTo(segs[i - 1]!.sourceEnd);
    });
  });
});

describe("wordSpanRange", () => {
  const ws = words("a", "so um this is it");

  it("cuts from gap middle to gap middle", () => {
    expect(wordSpanRange(ws, 1, 1, 3)).toEqual([expect.closeTo(0.55), expect.closeTo(1.15)]);
  });

  it("runs to the ends of the source at the edges", () => {
    expect(wordSpanRange(ws, 0, 0, 3)[0]).toBe(0);
    expect(wordSpanRange(ws, 4, 4, 3)[1]).toBe(3);
  });

  it("removes exactly the cut words", () => {
    const segs = setRange(initialSegments("a", 3, id), "a", wordSpanRange(ws, 1, 2, 3), false, id);
    expect(ws.map((w) => isWordKept(segs, w))).toEqual([true, false, false, true, true]);
  });
});
