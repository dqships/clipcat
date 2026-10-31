import { describe, expect, it } from "vitest";
import { assColor, assTime, captionCues, captionPixels, outputWords, srtTime, toAss, toSrt } from "./captions";
import { initialSegments, setRange } from "./edits";
import { counter, source, words } from "./fixtures";
import { Captions } from "./project";
import { buildTimeline } from "./timeline";

const id = counter("g");
const wide = { width: 1920, height: 1080 };
const tall = { width: 1080, height: 1920 };

function cut(text: string, duration: number, ranges: [number, number][]) {
  let segments = initialSegments("a", duration, id);
  for (const r of ranges) segments = setRange(segments, "a", r, false, id);
  const project = { sources: [source("a", duration)], transcript: words("a", text), segments, speed: 1 };
  return outputWords(project, buildTimeline(project));
}

describe("outputWords", () => {
  it("drops cut words and moves the rest onto the output timeline", () => {
    // "so um we": um sits at 0.6..1.1; cutting 0.55..1.15 pulls "we" back by 0.6 s.
    const out = cut("so um we", 2, [[0.55, 1.15]]);
    expect(out.map((w) => w.text)).toEqual(["so", "we"]);
    expect(out[1]!.start).toBeCloseTo(0.6);
  });
});

describe("captionCues", () => {
  it("ends a cue at a sentence end and at a pause", () => {
    const w = [
      { text: "Hello", start: 0, end: 0.4 },
      { text: "there.", start: 0.5, end: 0.9 },
      { text: "Next", start: 1, end: 1.4 },
      { text: "bit", start: 3, end: 3.4 },
    ];
    const cues = captionCues(w, "sentence", wide);
    expect(cues.map((c) => c.words.map((x) => x.text).join(" "))).toEqual(["Hello there.", "Next", "bit"]);
    expect(cues[0]!.end).toBe(1);
    expect(cues[1]!.end).toBeCloseTo(2);
    expect(cues[2]!.end).toBeCloseTo(3.7);
  });

  it("keeps lines short on a portrait frame and in word-by-word mode", () => {
    const w = "one two three four five six seven eight nine ten".split(" ").map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }));
    expect(captionCues(w, "sentence", wide)).toHaveLength(2);
    expect(captionCues(w, "sentence", tall).every((c) => c.words.map((x) => x.text).join(" ").length <= 22)).toBe(true);
    expect(captionCues(w, "word", wide).every((c) => c.words.length <= 3)).toBe(true);
  });
});

describe("formats", () => {
  it("writes times and colours the way ASS and SRT expect", () => {
    expect(assTime(3725.5)).toBe("1:02:05.50");
    expect(srtTime(3725.5)).toBe("01:02:05,500");
    expect(assColor("#F2B705")).toBe("&H0005B7F2");
  });

  it("writes an ASS script with one event per cue, or per word", () => {
    const cues = [{ start: 0, end: 1, words: [{ text: "Hi", start: 0, end: 0.4 }, { text: "{you}", start: 0.5, end: 0.9 }] }];
    const style = Captions.parse({ case: "upper" });
    const ass = toAss(cues, style, tall);
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("Style: Default,Jost SemiBold,");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,HI YOU");
    const words = toAss(cues, { ...style, mode: "word" }, wide).split("\n").filter((l) => l.startsWith("Dialogue"));
    expect(words).toHaveLength(2);
    expect(words[1]).toContain("{\\c&H0005B7F2}YOU{\\c&H00FFFFFF}");
  });

  it("draws the box in its colour, and highlights accent-coloured words in white", () => {
    const cues = [{ start: 0, end: 1, words: [{ text: "Hi", start: 0, end: 0.4 }, { text: "you", start: 0.5, end: 0.9 }] }];
    // libass fits Jost's full height to the size, so the em comes out at the preview's 54.
    expect(toAss(cues, Captions.parse({}), wide)).toContain("Style: Default,Jost SemiBold,78,");

    const boxed = toAss(cues, Captions.parse({ background: "rounded", boxColor: "#17150F" }), wide);
    expect(boxed).toMatch(/Style: Default,Jost SemiBold,\d+,&H00FFFFFF,&H00FFFFFF,&HFF000000,&H600F1517,0,0,0,0,100,100,0,0,4,/);
    const words = toAss(cues, Captions.parse({ mode: "word", color: "#F2B705" }), wide).split("\n").filter((l) => l.startsWith("Dialogue"));
    expect(words[1]).toContain("{\\c&H00FFFFFF}you{\\c&H0005B7F2}");
  });

  it("writes numbered SRT cues", () => {
    const srt = toSrt([{ start: 1, end: 2.5, words: [{ text: "Hi.", start: 1, end: 1.4 }] }], "regular");
    expect(srt).toBe("1\n00:00:01,000 --> 00:00:02,500\nHi.\n");
  });
});

describe("captionPixels", () => {
  it("scales from 1080p and sets portrait type larger", () => {
    expect(captionPixels(60, { width: 1920, height: 1080 })).toBe(60);
    expect(captionPixels(60, { width: 3840, height: 2160 })).toBe(120);
    expect(captionPixels(60, { width: 1080, height: 1920 })).toBe(96);
  });
});
