import { describe, expect, it } from "vitest";
import { fromStrip, keptParts, keptRanges, toStrip } from "./hiddenCuts";

const cut = (sourceStart: number, sourceEnd: number) => ({ sourceStart, sourceEnd });

describe("keptRanges", () => {
  it("takes the cuts out of the recording", () => {
    expect(keptRanges([cut(2, 4), cut(6, 7)], 10)).toEqual([
      [0, 2],
      [4, 6],
      [7, 10],
    ]);
  });

  it("handles cuts out of order, overlapping, and at the edges", () => {
    expect(keptRanges([cut(5, 8), cut(0, 1), cut(4, 6)], 8)).toEqual([[1, 4]]);
    expect(keptRanges([], 3)).toEqual([[0, 3]]);
    expect(keptRanges([cut(0, 3)], 3)).toEqual([]);
  });
});

describe("toStrip and fromStrip", () => {
  const kept = keptRanges([cut(2, 4), cut(6, 7)], 10); // 7 seconds kept

  it("closes the cuts up", () => {
    expect(toStrip(kept, 0)).toBe(0);
    expect(toStrip(kept, 5)).toBeCloseTo(3 / 7);
    expect(toStrip(kept, 10)).toBe(1);
  });

  it("puts a moment inside a cut where the cut was", () => {
    expect(toStrip(kept, 3)).toBeCloseTo(2 / 7);
    expect(toStrip(kept, 6.5)).toBeCloseTo(4 / 7);
  });

  it("maps a click back to the recording, skipping the cuts", () => {
    expect(fromStrip(kept, 3 / 7)).toBeCloseTo(5);
    expect(fromStrip(kept, 5 / 7)).toBeCloseTo(8);
    expect(fromStrip(kept, 1)).toBe(10);
    expect(fromStrip([], 0.5)).toBe(0);
  });
});

describe("keptParts", () => {
  it("keeps only the parts of a range that aren't cut", () => {
    const kept = keptRanges([cut(2, 4)], 10);
    expect(keptParts(kept, [1, 5])).toEqual([
      [1, 2],
      [4, 5],
    ]);
    expect(keptParts(kept, [2.5, 3.5])).toEqual([]);
  });
});
