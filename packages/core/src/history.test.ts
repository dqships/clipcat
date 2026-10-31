import { describe, expect, it } from "vitest";
import { type EditOp, HISTORY_LIMIT, SAME_STEP_MS, applyEdit } from "./editor";
import { initialSegments } from "./edits";
import { counter, source, words } from "./fixtures";
import { Project } from "./project";
import { heldByHistory } from "./history";
import { overlayProposal, defaultOverlay } from "./overlays";
import { soundProposal } from "./sounds";

const id = () => "g1";
const undo = (p: Project) => applyEdit(p, { type: "undo" }, id);
const redo = (p: Project) => applyEdit(p, { type: "redo" }, id);

/** What the edit is, leaving out the history itself. */
const state = (p: Project) => JSON.stringify({ ...p, history: null });

function project(): Project {
  const p = Project.parse({ version: 1, id: "p", name: "talk", revision: 0, sources: [source("a", 6)], transcript: words("a", "so um we start now"), segments: initialSegments("a", 6, counter("g")), proposals: [], captions: {}, createdAt: "", updatedAt: "" });
  p.music = [{ id: "t1", path: "/m/a.mp3", name: "a.mp3", duration: 60, volume: 0.15, duck: true, prep: "media/music/a.m4a", description: "", whole: true }];
  p.assets = [{ id: "m1", name: "a.png", path: "/a.png", kind: "image", media: { duration: 0, width: 10, height: 10 }, prep: { preview: "media/assets/m1/p.png", frames: [] }, description: "A dog", slide: null }];
  p.proposals = [
    overlayProposal({ id: "o1", sourceId: "a", wordIds: ["a-w0"], reason: "", confidence: 1, status: "accepted" }, defaultOverlay([0, 2], "m1", "pip")),
    soundProposal({ id: "s1", sourceId: "a", wordIds: ["a-w0"], reason: "", confidence: 1, status: "accepted" }, { at: 0, effect: "whoosh", volume: 0.7 }),
  ];
  p.thumbnail = { sourceId: "a", time: 3, frame: "f.jpg", subject: null, text: "", textColor: "paper", background: "frame", textSide: "left", textBox: null, behind: true };
  return p;
}

const EVERY: EditOp[] = [
  { type: "captions", captions: { size: 60 } },
  { type: "speed", speed: 1.5 },
  { type: "aspect", aspectRatio: "9:16" },
  { type: "bars", bars: "blur" },
  { type: "frame", sourceId: "a", x: 0.2 },
  { type: "overlay-style", id: "o1", corner: "bottom-left" },
  { type: "sound-volume", id: "s1", volume: 0.2 },
  { type: "music", volume: 0.5 },
  { type: "fix-word", wordId: "a-w3", text: "Start" },
  { type: "chapter", wordId: "a-w3", title: "Intro" },
  { type: "writeup", description: "About this" },
  { type: "thumbnail", text: "Hi" },
  { type: "describe", assetId: "m1", description: "A cat" },
  { type: "remove-music" },
  { type: "remove-asset", assetId: "m1" },
];

describe("undo of changes outside the cuts", () => {
  it.each(EVERY.map((op) => [op.type, op] as const))("takes back and redoes %s", (_, op) => {
    const before = project();
    const after = applyEdit(before, op, id);
    expect(state(after)).not.toBe(state(before));
    expect(after.history.past).toHaveLength(1);
    expect(state(undo(after))).toBe(state(before));
    expect(state(redo(undo(after)))).toBe(state(after));
  });

  it("goes back through mixed changes in order, so Undo never skips to an older cut", () => {
    const before = project();
    const cut = applyEdit(before, { type: "words", wordIds: ["a-w0"], included: false }, id);
    const fixed = applyEdit(cut, { type: "fix-word", wordId: "a-w3", text: "Start" }, id);
    const once = undo(fixed);
    expect(state(once)).toBe(state(cut));
    expect(state(undo(once))).toBe(state(before));
  });

  it("takes a chapter out again, and leaves no write-up where there was none", () => {
    const before = project();
    expect(before.writeup).toBeNull();
    const added = applyEdit(before, { type: "chapter", wordId: "a-w3", title: "Intro" }, id);
    const renamed = applyEdit(added, { type: "chapter", wordId: "a-w3", title: "Start" }, id);
    const removed = applyEdit(renamed, { type: "remove-chapter", wordId: "a-w3" }, id);
    expect(undo(removed).writeup?.chapters).toEqual([{ wordId: "a-w3", title: "Start" }]);
    expect(undo(undo(removed)).writeup?.chapters).toEqual([{ wordId: "a-w3", title: "Intro" }]);
    expect(undo(undo(undo(removed))).writeup).toBeNull();
  });

  it("brings removed media back in its place, with the b-roll that used it", () => {
    const before = project();
    before.assets.push({ ...before.assets[0]!, id: "m2", name: "b.png" });
    const removed = applyEdit(before, { type: "remove-asset", assetId: "m1" }, id);
    expect(removed.proposals.some((x) => x.id === "o1")).toBe(false);
    const back = undo(removed);
    expect(back.assets.map((a) => a.id)).toEqual(["m1", "m2"]);
    expect(back.proposals.map((x) => x.id)).toEqual(["o1", "s1"]);
  });

  it("makes no step for a change that changes nothing", () => {
    const p = project();
    expect(applyEdit(p, { type: "speed", speed: p.speed }, id).history.past).toHaveLength(0);
  });

  it("clears what could be redone", () => {
    const undone = undo(applyEdit(project(), { type: "speed", speed: 1.5 }, id));
    expect(undone.history.future).toHaveLength(1);
    expect(applyEdit(undone, { type: "bars", bars: "blur" }, id).history.future).toEqual([]);
  });

  it("leaves what a job finished in between", () => {
    const after = applyEdit(project(), { type: "describe", assetId: "m1", description: "A cat" }, id);
    after.assets[0]!.prep = { preview: "new.png", frames: [] };
    after.thumbnail!.frame = "new.jpg";
    const thumb = applyEdit(after, { type: "thumbnail", text: "Hi" }, id);
    thumb.thumbnail!.frame = "newer.jpg";
    const back = undo(undo(thumb));
    expect(back.assets[0]).toMatchObject({ description: "A dog", prep: { preview: "new.png" } });
    expect(back.thumbnail).toMatchObject({ text: "", frame: "newer.jpg" });
  });

  it("skips words a new transcription replaced", () => {
    const fixed = applyEdit(project(), { type: "fix-word", wordId: "a-w3", text: "Start" }, id);
    fixed.transcript = [];
    expect(undo(fixed).transcript).toEqual([]);
  });

  it("stores only what changed, not the transcript", () => {
    const p = project();
    const fixed = applyEdit(p, { type: "fix-word", wordId: "a-w3", text: "Start" }, id);
    expect(Object.keys(fixed.history.past[0]!.change!.lists.transcript!.fields)).toEqual(["a-w3"]);
    expect(JSON.stringify(fixed.history.past[0]!.change).length).toBeLessThan(200);
  });

  it("reads a project saved before these steps existed", () => {
    const p = project();
    const saved = { ...p, history: { past: [{ segments: p.segments, statuses: {} }], future: [] } };
    const read = Project.parse(JSON.parse(JSON.stringify(saved)));
    expect(undo(read).history.past).toEqual([]);
  });

  it("keeps the new steps through a save and a read", () => {
    const after = applyEdit(project(), { type: "remove-asset", assetId: "m1" }, id);
    const read = Project.parse(JSON.parse(JSON.stringify(after)));
    expect({ ...undo(read), history: null }).toEqual({ ...Project.parse(JSON.parse(JSON.stringify(project()))), history: null });
  });
});

describe("one drag is one undo step", () => {
  const drag = (p: Project, sizes: number[], gap = 50) => sizes.reduce((q, size, i) => applyEdit(q, { type: "captions", captions: { size } }, id, 1000 + i * gap), p);

  it("joins one control's changes while they keep coming", () => {
    const before = project();
    const dragged = drag(before, [40, 44, 48, 52, 56]);
    expect(dragged.history.past).toHaveLength(1);
    expect(dragged.captions.size).toBe(56);
    expect(undo(dragged).captions).toEqual(before.captions);
  });

  it("keeps a drag longer than the wait in one step", () => {
    const sizes = Array.from({ length: 40 }, (_, i) => 32 + i);
    expect(drag(project(), sizes, SAME_STEP_MS - 1).history.past).toHaveLength(1);
  });

  it("starts a new step after a pause, or on another control or recording", () => {
    const p = project();
    const twice = applyEdit(drag(p, [40]), { type: "captions", captions: { size: 50 } }, id, 1000 + SAME_STEP_MS);
    expect(twice.history.past).toHaveLength(2);
    const other = applyEdit(drag(p, [40]), { type: "captions", captions: { position: 0.5 } }, id, 1001);
    expect(other.history.past).toHaveLength(2);
    const a = applyEdit(p, { type: "sound-volume", id: "s1", volume: 0.2 }, id, 1000);
    a.proposals.push({ ...a.proposals[1]!, id: "s2" });
    expect(applyEdit(a, { type: "sound-volume", id: "s2", volume: 0.3 }, id, 1001).history.past).toHaveLength(2);
  });

  it("never joins word fixes", () => {
    const one = applyEdit(project(), { type: "fix-word", wordId: "a-w3", text: "Start" }, id, 1000);
    expect(applyEdit(one, { type: "fix-word", wordId: "a-w3", text: "Begin" }, id, 1001).history.past).toHaveLength(2);
  });

  it("keeps the history bounded with the new steps", () => {
    let p = project();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) p = applyEdit(p, { type: "bars", bars: i % 2 ? "black" : "blur" }, id);
    expect(p.history.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe("heldByHistory", () => {
  it("names removed media and music undo could bring back, either way", () => {
    const removed = applyEdit(applyEdit(project(), { type: "remove-asset", assetId: "m1" }, id), { type: "remove-music" }, id);
    expect(heldByHistory(removed.history)).toEqual({ assets: new Set(["m1"]), music: new Set(["media/music/a.m4a"]) });
    expect(heldByHistory(undo(undo(removed)).history)).toEqual({ assets: new Set(), music: new Set() });
    expect(heldByHistory(undo(removed).history).assets.has("m1")).toBe(true);
  });
});
