import type { Source, Thumbnail } from "@clipcat/core";
import { describe, expect, it } from "vitest";
import { clampBox, fitText, framePlacement, placePicture, textBox, thumbnailSize, thumbnailTextBox } from "./thumbnail";

/** Every letter as wide as half the font size. */
const measure = (line: string, size: number) => line.length * size * 0.5;

const WIDE = thumbnailSize("16:9");
const TALL = thumbnailSize("9:16");

const thumbnail: Thumbnail = { sourceId: "s1", time: 10, frame: "f.jpg", subject: null, text: "", textColor: "paper", background: "frame", textSide: "left", textBox: null, behind: true };
const source = (width: number, height: number, frameX = 0.5) => ({ id: "s1", media: { width, height }, frameX, framing: "manual", faces: null }) as unknown as Source;

describe("thumbnail layout", () => {
  it("is the video's shape: wide, or tall for 9:16", () => {
    expect(WIDE).toEqual({ width: 1280, height: 720 });
    expect(TALL).toEqual({ width: 1080, height: 1920 });
    expect(thumbnailSize("1:1")).toEqual(WIDE);
  });

  it("sets short text big on one line and long text smaller over more lines, never splitting a word", () => {
    const box = textBox("left", WIDE);
    const short = fitText("CUT IT", box, measure);
    expect(short.lines).toEqual(["CUT IT"]);
    expect(short.size).toBe(189);
    const long = fitText("HOW I EDIT A WHOLE VIDEO IN TEN MINUTES", box, measure);
    expect(long.lines.length).toBeGreaterThan(1);
    expect(long.lines.length).toBeLessThanOrEqual(4);
    expect(long.lines.join(" ")).toBe("HOW I EDIT A WHOLE VIDEO IN TEN MINUTES");
    expect(long.lines.every((l) => measure(l, long.size) <= box.width)).toBe(true);
    expect(fitText("  ", box, measure).lines).toEqual([]);
  });

  it("makes the text bigger in a bigger box", () => {
    const small = fitText("CUT IT", { width: 400, height: 200 }, measure);
    const big = fitText("CUT IT", { width: 1000, height: 600 }, measure);
    expect(big.size).toBeGreaterThan(small.size);
  });

  it("puts the text box in the chosen half, or the top of a tall thumbnail", () => {
    const left = textBox("left", WIDE);
    const right = textBox("right", WIDE);
    expect(left.x).toBeLessThan(WIDE.width / 2);
    expect(right.x + right.width).toBeLessThanOrEqual(WIDE.width);
    expect(right.x).toBeGreaterThan(left.x);
    const top = textBox("left", TALL);
    expect(top.width).toBeGreaterThan(TALL.width * 0.8);
    expect(top.y + top.height).toBeLessThan(TALL.height / 2);
  });

  it("puts the text where the user moved it, kept on the thumbnail", () => {
    expect(thumbnailTextBox({ textSide: "left", textBox: { x: 0.5, y: 0.25, width: 0.25, height: 0.5 } }, WIDE)).toEqual({ x: 640, y: 180, width: 320, height: 360 });
    expect(clampBox({ x: 0.9, y: -0.2, width: 0.5, height: 0.01 })).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.1 });
  });

  it("shows a vertical frame whole on a wide thumbnail instead of blowing it up", () => {
    const tall = framePlacement({ aspectRatio: "16:9", sources: [source(1080, 1920)], thumbnail }, { width: 1080, height: 1920 });
    expect(tall.at.height).toBe(720);
    expect(tall.at.width).toBeCloseTo(405);
    expect(tall.fills).toBe(false);
    const wide = framePlacement({ aspectRatio: "16:9", sources: [source(1920, 1080)], thumbnail }, { width: 1920, height: 1080 });
    expect(wide).toEqual({ at: { x: 0, y: 0, width: 1280, height: 720 }, fills: true });
  });

  it("fills a tall thumbnail with a vertical frame, and crops a wide one around the speaker", () => {
    const vertical = framePlacement({ aspectRatio: "9:16", sources: [source(1080, 1920)], thumbnail }, { width: 1080, height: 1920 });
    expect(vertical.at).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
    const left = framePlacement({ aspectRatio: "9:16", sources: [source(1920, 1080, 0)], thumbnail }, { width: 1920, height: 1080 });
    expect(left.at.x).toBeCloseTo(0);
    expect(left.at.height).toBe(1920);
    const right = framePlacement({ aspectRatio: "9:16", sources: [source(1920, 1080, 1)], thumbnail }, { width: 1920, height: 1080 });
    expect(right.at.x + right.at.width).toBeCloseTo(1080);
    // The export's format wins over the project's.
    expect(framePlacement({ aspectRatio: "9:16", sources: [], thumbnail }, { width: 1920, height: 1080 }, "16:9").at.width).toBe(1280);
    expect(placePicture(1920, 1080, WIDE, "cover")).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });
});
