import { describe, expect, it } from "vitest";
import { asset, counter, source, words } from "./fixtures";
import { validateProposals } from "./proposals";

const ws = [...words("a", "hi I am I am Dan and today"), ...words("b", "we start now", 0)];
const sources = [source("a", 6), source("b", 2, 1)];

describe("validateProposals", () => {
  it("turns a retake into cuts around the kept take", () => {
    const { proposals, errors } = validateProposals(
      { proposals: [{ type: "retake", from: 1, to: 4, keepFrom: 3, keepTo: 4, reason: "restart", confidence: 0.9 }] },
      ws,
      sources,
      counter("p"),
    );
    expect(errors).toEqual([]);
    expect(proposals[0]).toMatchObject({ type: "retake", sourceId: "a", wordIds: ["a-w1", "a-w2"], status: "pending" });
    expect(proposals[0]!.cuts).toHaveLength(1);
  });

  it("rejects hallucinated indices, cross-source spans and bad retakes", () => {
    const { proposals, errors } = validateProposals(
      {
        proposals: [
          { type: "cleanup", from: 40, to: 41, reason: "x", confidence: 0.5 },
          { type: "cleanup", from: 7, to: 9, reason: "x", confidence: 0.5 },
          { type: "retake", from: 1, to: 4, reason: "x", confidence: 0.5 },
          { type: "retake", from: 1, to: 4, keepFrom: 0, keepTo: 4, reason: "x", confidence: 0.5 },
          { type: "tighten", from: 5, to: 4, reason: "x", confidence: 0.5 },
          { type: "cleanup", from: 2, to: 2, keepFrom: 2, keepTo: 2, reason: "x", confidence: 0.5 },
        ],
      },
      ws,
      sources,
      counter("p"),
    );
    expect(proposals).toEqual([]);
    expect(errors).toHaveLength(6);
  });

  it("keeps the more confident of two overlapping proposals", () => {
    const { proposals, errors } = validateProposals(
      {
        proposals: [
          { type: "cleanup", from: 1, to: 2, reason: "low", confidence: 0.4 },
          { type: "tighten", from: 2, to: 3, reason: "high", confidence: 0.8 },
        ],
      },
      ws,
      sources,
      counter("p"),
    );
    expect(proposals.map((p) => p.reason)).toEqual(["high"]);
    expect(errors[0]).toMatch(/overlaps/);
  });

  it("maps indices in the second source onto that source's words", () => {
    const { proposals } = validateProposals(
      { proposals: [{ type: "cleanup", from: 9, to: 9, reason: "x", confidence: 0.7 }] },
      ws,
      sources,
      counter("p"),
    );
    expect(proposals[0]).toMatchObject({ sourceId: "b", wordIds: ["b-w1"] });
    const [[a, b]] = proposals[0]!.cuts as [[number, number]];
    expect(a).toBeCloseTo(0.55);
    expect(b).toBeCloseTo(1.15);
  });
});

describe("validateProposals punch-ins", () => {
  const long = [...words("a", "this is the one thing you need to remember about it", 0)];
  const one = [source("a", 8)];

  it("turns a punch-in into a range to zoom over that cuts nothing", () => {
    const { proposals, errors } = validateProposals(
      { proposals: [{ type: "punch-in", from: 3, to: 6, punchStyle: "slow-zoom", keepFrom: null, keepTo: null, reason: "The key point", confidence: 0.8 }] },
      long,
      one,
      counter("p"),
    );
    expect(errors).toEqual([]);
    expect(proposals[0]).toMatchObject({ type: "punch-in", cuts: [], wordIds: ["a-w3", "a-w4", "a-w5", "a-w6"], punch: { style: "slow-zoom", scale: 1.15 } });
    expect(proposals[0]!.punch!.range).toEqual([long[3]!.start, long[6]!.end]);
  });

  it("needs a style and a sensible length, and gives way to a cut on its words", () => {
    const { proposals, errors } = validateProposals(
      {
        proposals: [
          { type: "punch-in", from: 0, to: 4, reason: "x", confidence: 0.5 },
          { type: "punch-in", from: 2, to: 2, punchStyle: "cut", reason: "x", confidence: 0.5 },
          { type: "cleanup", from: 1, to: 1, punchStyle: "cut", reason: "x", confidence: 0.5 },
          { type: "punch-in", from: 5, to: 9, punchStyle: "cut", reason: "x", confidence: 0.5 },
          { type: "tighten", from: 8, to: 9, reason: "x", confidence: 0.9 },
        ],
      },
      long,
      one,
      counter("p"),
    );
    expect(proposals.map((p) => p.type)).toEqual(["tighten"]);
    expect(errors).toHaveLength(4);
    expect(errors.at(-1)).toContain("sits on words another proposal cuts");
  });
});

describe("validateProposals b-roll", () => {
  const long = [...words("a", "this is the one thing you need to remember about it", 0)];
  const one = [source("a", 8)];
  const assets = [asset("m1"), asset("m2")];

  it("turns b-roll into a range to cover that cuts nothing", () => {
    const { proposals, errors } = validateProposals(
      { proposals: [{ type: "visual", from: 2, to: 5, media: 1, placement: "pip", reason: "Shows the thing", confidence: 0.7 }] },
      long,
      one,
      counter("p"),
      assets,
    );
    expect(errors).toEqual([]);
    expect(proposals[0]).toMatchObject({ type: "visual", cuts: [], wordIds: ["a-w2", "a-w3", "a-w4", "a-w5"], overlay: { assetId: "m2", placement: "pip" } });
    expect(proposals[0]!.overlay!.range).toEqual([long[2]!.start, long[5]!.end]);
  });

  it("needs real media, a placement and a sensible length, only on b-roll, and gives way to a cut", () => {
    const { proposals, errors } = validateProposals(
      {
        proposals: [
          { type: "visual", from: 0, to: 4, media: 7, placement: "full", reason: "x", confidence: 0.5 },
          { type: "visual", from: 0, to: 4, media: 0, reason: "x", confidence: 0.5 },
          { type: "visual", from: 2, to: 2, media: 0, placement: "full", reason: "x", confidence: 0.5 },
          { type: "cleanup", from: 1, to: 1, media: 0, reason: "x", confidence: 0.5 },
          { type: "visual", from: 5, to: 9, media: 0, placement: "full", reason: "x", confidence: 0.5 },
          { type: "punch-in", from: 5, to: 9, punchStyle: "cut", reason: "x", confidence: 0.4 },
          { type: "tighten", from: 9, to: 9, reason: "x", confidence: 0.9 },
        ],
      },
      long,
      one,
      counter("p"),
      assets,
    );
    expect(proposals.map((p) => p.type)).toEqual(["tighten"]);
    expect(errors).toHaveLength(6);
    expect(errors[0]).toContain("media to a number from the media list (0..1)");
    expect(errors.at(-1)).toContain("b-roll at word 5: it sits on words another proposal cuts");
  });
});
