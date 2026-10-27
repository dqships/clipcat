import { describe, expect, it } from "vitest";
import { cropOffset, framingAt, speakerX } from "./framing";

const faces = [
  { t: 0, x: 0.3 },
  { t: 2, x: 0.32 },
  { t: 4, x: 0.7 },
  { t: 20, x: 0.6 },
];

describe("framingAt", () => {
  it("takes the median face inside the range", () => {
    expect(framingAt({ frameX: 0.5, framing: "auto", faces }, 0, 3)).toBeCloseTo(0.31);
  });

  it("looks a few seconds either side, then at the whole recording", () => {
    expect(framingAt({ frameX: 0.5, framing: "auto", faces }, 22, 23)).toBe(0.6);
    expect(framingAt({ frameX: 0.5, framing: "auto", faces }, 10, 12)).toBeCloseTo(0.46);
  });

  it("uses frameX when the user set it or no faces were found", () => {
    expect(framingAt({ frameX: 0.8, framing: "manual", faces }, 0, 3)).toBe(0.8);
    expect(framingAt({ frameX: 0.5, framing: "auto", faces: [] }, 0, 3)).toBe(0.5);
    expect(framingAt({ frameX: 0.5, framing: "auto", faces: null }, 0, 3)).toBe(0.5);
  });
});

describe("cropOffset", () => {
  const wide = 16 / 9;
  const tall = 9 / 16;

  it("centres the speaker in a 9:16 crop of a 16:9 frame where the edges allow", () => {
    // The crop is 0.316 of the width wide; a speaker at 0.5 needs it in the middle.
    expect(cropOffset(0.5, wide, tall)).toBeCloseTo(0.5);
    // At 0.3, its left edge is at 0.142 of the 0.684 it can move.
    expect(cropOffset(0.3, wide, tall)).toBeCloseTo((0.3 - 0.31640625 / 2) / (1 - 0.31640625));
    expect(cropOffset(0.05, wide, tall)).toBe(0);
    expect(cropOffset(0.98, wide, tall)).toBe(1);
  });

  it("has nothing to move when the crop is as wide as the frame", () => {
    expect(cropOffset(0.2, tall, tall)).toBe(0.5);
  });
});

describe("speakerX", () => {
  it("picks the biggest face, leaning to the middle", () => {
    expect(speakerX([])).toBeNull();
    expect(speakerX([{ x: 0.1, y: 0.2, width: 0.1, height: 0.15 }, { x: 0.5, y: 0.2, width: 0.2, height: 0.3 }])).toBeCloseTo(0.6);
  });
});
