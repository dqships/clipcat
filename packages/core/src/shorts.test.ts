import { describe, expect, it } from "vitest";
import { initialSegments, setRange } from "./edits";
import { counter, source, words } from "./fixtures";
import { buildTimeline } from "./timeline";
import { Project } from "./project";
import { keptParts, shortProject, shortSegments, validateShorts } from "./shorts";

// 20 words at 0.6 s steps: 12 s of speech in "a", then 5 words in "b".
const textA = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
const ws = [...words("a", textA), ...words("b", "one two three four five")];
const sources = [source("a", 12.5), source("b", 3.5, 1)];
const whole = [...initialSegments("a", 12.5, counter("a")), ...initialSegments("b", 3.5, counter("b"))];
const limits = { count: 3, seconds: 30 };

describe("validateShorts", () => {
  it("turns word ranges into source ranges with a short lead-in and tail", () => {
    const { shorts, errors } = validateShorts({ shorts: [{ title: " Hook ", reason: "Stands alone", ranges: [{ from: 2, to: 12 }] }] }, ws, sources, whole, limits);
    expect(errors).toEqual([]);
    expect(shorts).toHaveLength(1);
    const [short] = shorts;
    expect(short!.title).toBe("Hook");
    expect(short!.keep).toHaveLength(1);
    // Word 2 starts at 1.2 s and word 12 ends at 7.7 s; the gaps either side are 0.1 s, so the edges sit in their middles.
    expect(short!.keep[0]!.range[0]).toBeCloseTo(1.15);
    expect(short!.keep[0]!.range[1]).toBeCloseTo(7.75);
    expect(short!.seconds).toBeCloseTo(6.6);
  });

  it("keeps only what the long edit keeps", () => {
    const edited = setRange(whole, "a", [3, 5], false, counter("x"));
    const { shorts } = validateShorts({ shorts: [{ title: "T", reason: "R", ranges: [{ from: 2, to: 16 }] }] }, ws, sources, edited, limits);
    expect(shorts[0]!.keep.map((k) => k.range)).toEqual([
      [expect.closeTo(1.15), 3],
      [5, expect.closeTo(10.15)],
    ]);
    expect(shorts[0]!.seconds).toBeCloseTo(7);
  });

  it("rejects bad ranges, lengths and extras, and says why", () => {
    const { shorts, errors } = validateShorts(
      {
        shorts: [
          { title: "Ghost", reason: "x", ranges: [{ from: 30, to: 31 }] },
          { title: "Across", reason: "x", ranges: [{ from: 18, to: 21 }] },
          { title: "Backwards", reason: "x", ranges: [{ from: 10, to: 12 }, { from: 2, to: 4 }] },
          { title: "Tiny", reason: "x", ranges: [{ from: 0, to: 2 }] },
          { title: "Long", reason: "x", ranges: [{ from: 0, to: 19 }] },
          { title: "Fine", reason: "x", ranges: [{ from: 0, to: 9 }] },
          { title: "Same", reason: "x", ranges: [{ from: 0, to: 9 }] },
        ],
      },
      ws,
      sources,
      whole,
      { count: 3, seconds: 10 },
    );
    expect(shorts.map((s) => s.title)).toEqual(["Fine"]);
    expect(errors).toHaveLength(6);
    expect(errors[0]).toContain("word indices");
    expect(errors[1]).toContain("one recording");
    expect(errors[2]).toContain("in order");
    expect(errors[3]).toContain("at least 5 s");
    expect(errors[4]).toContain("too long");
    expect(errors[5]).toContain("same as an earlier short");
  });

  it("keeps at most the number asked for", () => {
    const short = (from: number, to: number) => ({ title: `${from}`, reason: "x", ranges: [{ from, to }] });
    const { shorts, errors } = validateShorts({ shorts: [short(0, 9), short(10, 19)] }, ws, sources, whole, { count: 1, seconds: 30 });
    expect(shorts).toHaveLength(1);
    expect(errors[0]).toContain("only 1 short was asked for");
  });
});

describe("shortSegments", () => {
  it("cuts everything but the short, across recordings, and plays in order", () => {
    const { shorts } = validateShorts(
      { shorts: [{ title: "T", reason: "R", ranges: [{ from: 0, to: 9 }, { from: 20, to: 24 }] }] },
      ws,
      sources,
      whole,
      limits,
    );
    const durations: Record<string, number> = { a: 12.5, b: 3.5 };
    const segments = shortSegments(shorts[0]!, (id) => durations[id]!, counter("s"));
    expect(segments.filter((s) => s.included).map((s) => [s.sourceId, s.sourceStart])).toEqual([
      ["a", 0],
      ["b", 0],
    ]);
    expect(segments.find((s) => s.sourceId === "a" && !s.included)?.sourceEnd).toBe(12.5);
    const timeline = buildTimeline({ sources, segments, speed: 1 });
    expect(timeline.duration).toBeCloseTo(shorts[0]!.seconds);
  });
});

describe("keptParts", () => {
  it("clips a range to the included segments", () => {
    const edited = setRange(whole, "a", [2, 4], false, counter("x"));
    expect(keptParts(edited, "a", [1, 6])).toEqual([
      [1, 2],
      [4, 6],
    ]);
    expect(keptParts(edited, "a", [2.5, 3.5])).toEqual([]);
  });
});

describe("shortProject", () => {
  it("makes a vertical project from the recordings the short uses, with the suggestions inside it", () => {
    const parent = Project.parse({
      version: 1,
      id: "long",
      name: "Long talk",
      speed: 1.25,
      revision: 9,
      sources: sources,
      transcript: ws,
      segments: whole,
      proposals: [
        { id: "in", type: "silence", sourceId: "a", cuts: [[2, 3]], wordIds: [], reason: "Pause", confidence: 0.9, status: "pending" },
        { id: "out", type: "silence", sourceId: "a", cuts: [[9, 10]], wordIds: [], reason: "Pause", confidence: 0.9, status: "pending" },
        { id: "done", type: "cleanup", sourceId: "a", cuts: [[3, 4]], wordIds: [], reason: "Um", confidence: 0.9, status: "rejected" },
      ],
      captions: { size: 70 },
      createdAt: "t",
      updatedAt: "t",
    });
    const { shorts } = validateShorts({ shorts: [{ title: "The hook", reason: "Bold claim", ranges: [{ from: 0, to: 12 }] }] }, ws, sources, whole, limits);
    const short = Project.parse(shortProject(parent, shorts[0]!, { id: "s1", now: "now", segmentId: counter("g") }));
    expect(short).toMatchObject({ id: "s1", name: "The hook", aspectRatio: "9:16", speed: 1.25, revision: 0 });
    expect(short.origin).toEqual({ projectId: "long", name: "Long talk", reason: "Bold claim" });
    expect(short.sources.map((s) => s.id)).toEqual(["a"]);
    expect(short.transcript.every((w) => w.sourceId === "a")).toBe(true);
    expect(short.proposals.map((p) => p.id)).toEqual(["in"]);
    expect(short.captions.size).toBe(70);
  });
});
