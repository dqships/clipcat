import { describe, expect, it } from "vitest";
import { source } from "./fixtures";
import { PUNCH, punchFocus, punchProposal, punchZoom, spacePunches, spaceProposedPunches, timedPunches } from "./punchins";
import { buildTimeline } from "./timeline";

const seg = (id: string, sourceStart: number, sourceEnd: number, included = true) => ({ id, sourceId: "a", sourceStart, sourceEnd, included });

describe("timedPunches", () => {
  const timeline = buildTimeline({ sources: [source("a", 30)], speed: 2, segments: [seg("1", 0, 10), seg("2", 10, 14, false), seg("3", 14, 30)] });
  const punch = (id: string, range: [number, number], status: "accepted" | "pending" = "accepted") =>
    punchProposal({ id, sourceId: "a", wordIds: [], reason: "", confidence: 1, status }, range, "zoom-in");

  it("times accepted punch-ins on the output, across a cut and at speed", () => {
    expect(timedPunches({ proposals: [punch("p2", [16, 20]), punch("p1", [8, 16]), punch("p3", [0, 4], "pending")] }, timeline)).toEqual([
      // 8..10 plays at 4..5, the cut 10..14 is skipped, 14..16 plays at 5..6.
      { id: "p1", sourceId: "a", range: [8, 16], style: "zoom-in", scale: 1.2, start: 4, end: 6 },
      { id: "p2", sourceId: "a", range: [16, 20], style: "zoom-in", scale: 1.2, start: 6, end: 8 },
    ]);
  });

  it("leaves out a punch-in whose words were all cut", () => {
    expect(timedPunches({ proposals: [punch("p", [11, 13])] }, timeline)).toEqual([]);
  });
});

describe("punchZoom", () => {
  const at = (style: "cut" | "zoom-in" | "slow-zoom", t: number) => punchZoom({ style, scale: 1.2, start: 10, end: 14 }, t);

  it("snaps, pushes in quickly, or creeps in, and is 1 outside", () => {
    expect([at("cut", 9.9), at("cut", 10), at("cut", 14)]).toEqual([1, 1.2, 1]);
    expect(at("zoom-in", 10 + PUNCH.ramp / 2)).toBeCloseTo(1.1);
    expect(at("zoom-in", 12)).toBeCloseTo(1.2);
    expect(at("slow-zoom", 12)).toBeCloseTo(1.1);
  });
});

describe("spacePunches", () => {
  it("keeps the best punch-ins that leave room around each other and around accepted ones", () => {
    const c = (name: string, start: number, end: number, score: number) => ({ name, start, end, score });
    const { kept, dropped } = spacePunches(
      [c("a", 0, 3, 0.5), c("b", 5, 8, 0.9), c("c", 14, 17, 0.8), c("d", 40, 43, 0.4), c("e", 52, 54, 0.9)],
      (x, y) => y.score - x.score,
      [{ start: 30, end: 33 }],
    );
    // b beats a, which starts too soon after it; c starts 9 s after b; d and e clear the accepted one at 30 and each other.
    expect(kept.map((k) => k.name)).toEqual(["b", "d", "e"]);
    expect(dropped.map((k) => k.name).sort()).toEqual(["a", "c"]);
  });
});

describe("punchFocus", () => {
  const s = { frameX: 0.5, framing: "auto" as const, faces: [{ t: 1, x: 0.3 }, { t: 20, x: 0.6 }] };

  it("aims at the speaker across a landscape frame", () => {
    expect(punchFocus(s, [0, 30], [19, 22], 16 / 9, 16 / 9)).toEqual({ x: 0.6, y: PUNCH.focusY });
  });

  it("aims inside the vertical crop the kept range has", () => {
    // The crop for 0..30 is centred on the median face, 0.45; the punch's speaker is at 0.6.
    const width = (9 / 16) / (16 / 9);
    const left = 0.45 - width / 2;
    expect(punchFocus(s, [0, 30], [19, 22], 16 / 9, 9 / 16).x).toBeCloseTo((0.6 - left) / width, 6);
  });
});

describe("spaceProposedPunches", () => {
  it("drops the less confident of two crowded punch-ins, and any crowding an accepted one", () => {
    const make = (id: string, range: [number, number], confidence: number, status: "accepted" | "pending" = "pending") =>
      punchProposal({ id, sourceId: "a", wordIds: [`w-${id}`], reason: "", confidence, status }, range, "cut");
    const project = {
      sources: [source("a", 60)],
      segments: [seg("1", 0, 60)],
      speed: 1,
      proposals: [make("old", [40, 42], 1, "accepted")],
    };
    const fresh = [make("p1", [2, 4], 0.5), make("p2", [6, 8], 0.9), make("p3", [44, 46], 0.9), make("p4", [20, 22], 0.6)];
    const words = ["w-p1", "w-p2", "w-p3", "w-p4"].map((id) => ({ id }));
    const { proposals, errors } = spaceProposedPunches(project, fresh, words);
    expect(proposals.map((p) => p.id)).toEqual(["p2", "p4"]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^punch-in at word 0: too close/);
  });
});
