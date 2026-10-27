import { describe, expect, it } from "vitest";
import { initialSegments, isWordKept } from "./edits";
import { EditOp, HISTORY_LIMIT, applyEdit } from "./editor";
import { counter, source, words } from "./fixtures";
import { Project } from "./project";

function project() {
  const id = counter("g");
  return Project.parse({
    version: 1,
    id: "p",
    name: "talk",
    revision: 0,
    sources: [source("a", 6)],
    transcript: words("a", "so um we start now"),
    segments: initialSegments("a", 6, id),
    proposals: [
      { id: "x1", type: "cleanup", sourceId: "a", cuts: [[0.55, 1.15]], wordIds: ["a-w1"], reason: "Filler", confidence: 0.9, status: "pending" },
      { id: "x2", type: "silence", sourceId: "a", cuts: [[3.2, 5.9]], wordIds: [], reason: "Pause", confidence: 1, status: "pending" },
    ],
    captions: {},
    createdAt: "",
    updatedAt: "",
  });
}

const kept = (p: Project) => p.transcript.filter((w) => isWordKept(p.segments, w)).map((w) => w.text);
const id = counter("s");

describe("applyEdit", () => {
  it("cuts and restores words, one run at a time", () => {
    let p = applyEdit(project(), { type: "words", wordIds: ["a-w0", "a-w1", "a-w3"], included: false }, id);
    expect(kept(p)).toEqual(["we", "now"]);
    p = applyEdit(p, { type: "words", wordIds: ["a-w1"], included: true }, id);
    expect(kept(p)).toEqual(["um", "we", "now"]);
  });

  it("applies an accepted proposal and lifts it again when rejected", () => {
    let p = applyEdit(project(), { type: "decide", ids: ["x1"], status: "accepted" }, id);
    expect(kept(p)).toEqual(["so", "we", "start", "now"]);
    expect(p.proposals[0]!.status).toBe("accepted");
    p = applyEdit(p, { type: "decide", ids: ["x1"], status: "rejected" }, id);
    expect(kept(p)).toEqual(["so", "um", "we", "start", "now"]);
    expect(p.segments).toHaveLength(1);
  });

  it("accepts several at once", () => {
    const p = applyEdit(project(), { type: "decide", ids: ["x1", "x2"], status: "accepted" }, id);
    expect(p.segments.filter((s) => !s.included)).toHaveLength(2);
  });

  it("undoes and redoes, and a new edit clears redo", () => {
    const start = project();
    let p = applyEdit(start, { type: "decide", ids: ["x1"], status: "accepted" }, id);
    p = applyEdit(p, { type: "words", wordIds: ["a-w4"], included: false }, id);
    p = applyEdit(p, { type: "undo" }, id);
    expect(kept(p)).toEqual(["so", "we", "start", "now"]);
    p = applyEdit(p, { type: "undo" }, id);
    expect(p.segments).toEqual(start.segments);
    expect(p.proposals[0]!.status).toBe("pending");
    p = applyEdit(p, { type: "redo" }, id);
    expect(p.proposals[0]!.status).toBe("accepted");
    p = applyEdit(p, { type: "words", wordIds: ["a-w0"], included: false }, id);
    expect(p.history.future).toEqual([]);
    expect(applyEdit(p, { type: "redo" }, id).segments).toEqual(p.segments);
  });

  it("keeps a bounded history", () => {
    let p = project();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) p = applyEdit(p, { type: "words", wordIds: ["a-w0"], included: i % 2 === 1 }, id);
    expect(p.history.past).toHaveLength(HISTORY_LIMIT);
  });

  it("refuses words or proposals it doesn't know", () => {
    expect(() => applyEdit(project(), { type: "words", wordIds: ["nope"], included: false }, id)).toThrow("Unknown words: nope");
    expect(() => applyEdit(project(), { type: "decide", ids: ["nope"], status: "accepted" }, id)).toThrow("Unknown proposals: nope");
  });
});

describe("caption edits", () => {
  it("changes the style without an undo step", () => {
    let p = applyEdit(project(), { type: "captions", captions: { mode: "word", case: "upper" } }, id);
    p = applyEdit(p, { type: "captions", captions: { enabled: false } }, id);
    expect(p.captions).toMatchObject({ mode: "word", case: "upper", enabled: false });
    expect(p.history.past).toHaveLength(0);
  });

  it("sets the speed without an undo step", () => {
    const p = applyEdit(project(), { type: "speed", speed: 1.25 }, id);
    expect(p.speed).toBe(1.25);
    expect(p.history.past).toHaveLength(0);
    expect(EditOp.safeParse({ type: "speed", speed: 3 }).success).toBe(false);
  });
});
