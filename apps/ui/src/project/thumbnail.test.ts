import { describe, expect, it } from "vitest";
import { THUMBNAIL, cover, fitText, textBox } from "./thumbnail";

/** Every letter as wide as half the font size. */
const measure = (line: string, size: number) => line.length * size * 0.5;

describe("thumbnail layout", () => {
  it("sets short text big on one line and long text smaller over more lines, never splitting a word", () => {
    const box = textBox("left");
    const short = fitText("CUT IT", box, measure);
    expect(short.lines).toEqual(["CUT IT"]);
    expect(short.size).toBe(190);
    const long = fitText("HOW I EDIT A WHOLE VIDEO IN TEN MINUTES", box, measure);
    expect(long.lines.length).toBeGreaterThan(1);
    expect(long.lines.length).toBeLessThanOrEqual(4);
    expect(long.lines.join(" ")).toBe("HOW I EDIT A WHOLE VIDEO IN TEN MINUTES");
    expect(long.lines.every((l) => measure(l, long.size) <= box.width)).toBe(true);
    expect(fitText("  ", box, measure).lines).toEqual([]);
  });

  it("puts the text box in the chosen half and covers the thumbnail with any picture", () => {
    const left = textBox("left");
    const right = textBox("right");
    expect(left.x).toBeLessThan(THUMBNAIL.width / 2);
    expect(right.x + right.width).toBeLessThanOrEqual(THUMBNAIL.width);
    expect(right.x).toBeGreaterThan(left.x);
    // A vertical frame fills the width and is cropped top and bottom.
    const tall = cover(1080, 1920);
    expect(tall.width).toBe(THUMBNAIL.width);
    expect(tall.y).toBeLessThan(0);
    expect(cover(1920, 1080)).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });
});
