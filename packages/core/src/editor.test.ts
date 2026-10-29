import { describe, expect, it } from "vitest";
import { initialSegments, isWordKept } from "./edits";
import { EditOp, HISTORY_LIMIT, applyEdit } from "./editor";
import { asset, counter, source, words } from "./fixtures";
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

describe("applyEdit framing", () => {
  it("sets the shape and a hand-set framing without an undo step, and goes back to auto", () => {
    const p = project();
    const tall = applyEdit(p, { type: "aspect", aspectRatio: "9:16" }, counter("g"));
    expect(tall.aspectRatio).toBe("9:16");
    const set = applyEdit(tall, { type: "frame", sourceId: "a", x: 0.3 }, counter("g"));
    expect(set.sources[0]).toMatchObject({ framing: "manual", frameX: 0.3 });
    expect(applyEdit(set, { type: "frame", sourceId: "a", x: null }, counter("g")).sources[0]!.framing).toBe("auto");
    expect(set.history.past).toHaveLength(0);
    expect(() => applyEdit(p, { type: "frame", sourceId: "nope", x: 0.5 }, counter("g"))).toThrow("Unknown source");
  });
});

describe("applyEdit punch-ins", () => {
  it("punches in on words as one undo step, and changes the style without one", () => {
    const p = project();
    const punched = applyEdit(p, { type: "punch", wordIds: ["a-w4", "a-w3"], style: "zoom-in" }, counter("n"));
    const added = punched.proposals.at(-1)!;
    expect(added).toMatchObject({ type: "punch-in", status: "accepted", wordIds: ["a-w3", "a-w4"], cuts: [], punch: { style: "zoom-in", scale: 1.2 } });
    expect(added.punch!.range[0]).toBeCloseTo(1.8);
    expect(added.punch!.range[1]).toBeCloseTo(2.9);
    expect(punched.history.past).toHaveLength(1);
    // Cuts are untouched.
    expect(kept(punched)).toEqual(kept(p));

    const snapped = applyEdit(punched, { type: "punch-style", id: added.id, style: "cut" }, counter("n"));
    expect(snapped.proposals.at(-1)!.punch).toMatchObject({ style: "cut", scale: 1.25 });
    expect(snapped.history.past).toHaveLength(1);

    const undone = applyEdit(snapped, { type: "undo" }, counter("n"));
    expect(undone.proposals.at(-1)!.status).toBe("rejected");
    expect(applyEdit(undone, { type: "redo" }, counter("n")).proposals.at(-1)!.status).toBe("accepted");
  });

  it("refuses unknown words and punch-ins", () => {
    const p = project();
    expect(() => applyEdit(p, { type: "punch", wordIds: ["nope"], style: "cut" }, counter("n"))).toThrow("Unknown words: nope");
    expect(() => applyEdit(p, { type: "punch-style", id: "x1", style: "cut" }, counter("n"))).toThrow("Unknown punch-in");
  });
});

describe("applyEdit b-roll", () => {
  const withMedia = () => Project.parse({ ...project(), assets: [asset("m1")] });

  it("adds b-roll on words as one undo step, and restyles it without one", () => {
    const p = withMedia();
    const added = applyEdit(p, { type: "overlay", wordIds: ["a-w2", "a-w3"], assetId: "m1", placement: "full" }, counter("n"));
    const o = added.proposals.at(-1)!;
    expect(o).toMatchObject({ type: "visual", status: "accepted", cuts: [], overlay: { assetId: "m1", placement: "full", corner: "top-right" } });
    expect(added.history.past).toHaveLength(1);
    expect(kept(added)).toEqual(kept(p));

    const styled = applyEdit(added, { type: "overlay-style", id: o.id, placement: "pip", shape: "circle" }, counter("n"));
    expect(styled.proposals.at(-1)!.overlay).toMatchObject({ placement: "pip", shape: "circle", size: 0.35 });
    expect(styled.history.past).toHaveLength(1);
    expect(applyEdit(styled, { type: "undo" }, counter("n")).proposals.at(-1)!.status).toBe("rejected");
  });

  it("describes and removes media, and the b-roll that used it goes too", () => {
    const p = applyEdit(withMedia(), { type: "overlay", wordIds: ["a-w2"], assetId: "m1", placement: "pip" }, counter("n"));
    expect(applyEdit(p, { type: "describe", assetId: "m1", description: " Stock footage " }, counter("n")).assets[0]!.description).toBe("Stock footage");
    const removed = applyEdit(p, { type: "remove-asset", assetId: "m1" }, counter("n"));
    expect(removed.assets).toEqual([]);
    expect(removed.proposals.some((x) => x.overlay)).toBe(false);
  });

  it("refuses unknown media and b-roll", () => {
    const p = withMedia();
    expect(() => applyEdit(p, { type: "overlay", wordIds: ["a-w2"], assetId: "nope", placement: "full" }, counter("n"))).toThrow("Unknown media");
    expect(() => applyEdit(p, { type: "overlay-style", id: "x1", size: 0.3 }, counter("n"))).toThrow("Unknown b-roll");
    expect(() => applyEdit(p, { type: "describe", assetId: "nope", description: "" }, counter("n"))).toThrow("Unknown media");
  });
});

describe("applyEdit slides", () => {
  it("adds a slide to design over words as one undo step, and a new brief has it designed again", () => {
    const p = applyEdit(project(), { type: "slide", wordIds: ["a-w2", "a-w3"], brief: "Three steps\nPlan, cut, ship", look: "paper" }, counter("n"));
    const slide = p.assets.at(-1)!;
    expect(slide).toMatchObject({ kind: "slide", name: "Three steps", prep: null, slide: { look: "paper", html: "" } });
    expect(p.proposals.at(-1)).toMatchObject({ type: "visual", status: "accepted", overlay: { assetId: slide.id, placement: "full" } });
    expect(p.history.past).toHaveLength(1);

    const designed = structuredClone(p);
    designed.assets.at(-1)!.slide!.html = "<h1>Three steps</h1>";
    designed.assets.at(-1)!.prep = { preview: "still.jpg", frames: ["still.jpg"] };
    const rebriefed = applyEdit(designed, { type: "describe", assetId: slide.id, description: "Four steps" }, counter("m"));
    expect(rebriefed.assets.at(-1)).toMatchObject({ name: "Four steps", prep: null, slide: { brief: "Four steps", html: "" } });
    const same = applyEdit(designed, { type: "describe", assetId: slide.id, description: "Three steps\nPlan, cut, ship" }, counter("m"));
    expect(same.assets.at(-1)!.slide!.html).toBe("<h1>Three steps</h1>");
  });
});

describe("thumbnail edits", () => {
  it("change the text and colours once there is a frame, and are not undo steps", () => {
    const p = project();
    expect(() => applyEdit(p, { type: "thumbnail", text: "Hi" }, counter("t"))).toThrow("Pick a frame");
    p.thumbnail = { sourceId: p.sources[0]!.id, time: 3, frame: "media/thumbnail/frame-1.jpg", subject: null, text: "", textColor: "paper", background: "frame", textSide: "left", textBox: null, behind: true };
    const next = applyEdit(p, { type: "thumbnail", text: "Cut the fluff", background: "blur", textSide: "right" }, counter("t"));
    expect(next.thumbnail).toMatchObject({ text: "Cut the fluff", background: "blur", textSide: "right", textColor: "paper" });
    expect(next.history.past).toHaveLength(0);
    expect(EditOp.safeParse({ type: "thumbnail", textColor: "red" }).success).toBe(false);
    // The text can be moved anywhere on the thumbnail, and put back.
    const moved = applyEdit(next, { type: "thumbnail", textBox: { x: 0.1, y: 0.6, width: 0.5, height: 0.3 } }, counter("t"));
    expect(moved.thumbnail?.textBox).toEqual({ x: 0.1, y: 0.6, width: 0.5, height: 0.3 });
    expect(applyEdit(moved, { type: "thumbnail", textBox: null }, counter("t")).thumbnail?.textBox).toBeNull();
    expect(EditOp.safeParse({ type: "thumbnail", textBox: { x: 0.8, y: 0, width: 0.5, height: 0.5 } }).success).toBe(false);
  });
});
