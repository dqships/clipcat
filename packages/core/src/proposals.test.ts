import { describe, expect, it } from "vitest";
import { counter, source, words } from "./fixtures";
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
