import { describe, expect, it } from "vitest";
import { applyEdit } from "./editor";
import { counter, source, words } from "./fixtures";
import { initialSegments, setRange } from "./edits";
import { Project } from "./project";
import { validateProposals } from "./proposals";
import { SOUND_EFFECTS, soundIds, soundProposal, timedSounds } from "./sounds";
import { buildTimeline } from "./timeline";

const ws = words("a", "hi I am Dan and today we start");

function project() {
  const id = counter("s");
  return Project.parse({
    version: 1, id: "p", name: "p", revision: 0, sources: [source("a", 6)], transcript: ws,
    segments: setRange(initialSegments("a", 6, id), "a", [1, 2], false, id),
    proposals: [], captions: {}, createdAt: "", updatedAt: "",
  });
}

describe("sound effects", () => {
  it("lands an effect on a word as one undo step, and sets its volume without one", () => {
    const p = applyEdit(project(), { type: "sound", wordId: "a-w3", effect: "pop" }, counter("n"));
    const added = p.proposals.at(-1)!;
    expect(added).toMatchObject({ type: "sound", status: "accepted", wordIds: ["a-w3"], sound: { at: ws[3]!.start, effect: "pop", volume: 0.7 } });
    expect(p.history.past).toHaveLength(1);
    const louder = applyEdit(p, { type: "sound-volume", id: added.id, volume: 1 }, counter("n"));
    expect(louder.proposals.at(-1)!.sound!.volume).toBe(1);
    expect(louder.history.past).toHaveLength(1);
    expect(() => applyEdit(p, { type: "sound-volume", id: "nope", volume: 1 }, counter("n"))).toThrow("Unknown sound");
  });

  it("times accepted effects on the output, leaving out one whose moment is cut", () => {
    const p = project();
    const at = (id: string, t: number, status: "accepted" | "pending" = "accepted") =>
      soundProposal({ id, sourceId: "a", wordIds: [], reason: "", confidence: 1, status }, { at: t, effect: "pop", volume: 0.5 });
    p.proposals = [at("x", 3), at("y", 1.5), at("z", 0.5), at("w", 4, "pending")];
    // 1–2 s is cut, so 3 s plays at 2 s.
    expect(timedSounds(p, buildTimeline(p)).map((s) => [s.id, s.time])).toEqual([
      ["z", 0.5],
      ["x", 2],
    ]);
  });

  it("checks the agent's effects: a known id on one word, spaced out, not on cut words", () => {
    const { proposals, errors } = validateProposals(
      {
        proposals: [
          { type: "sound", from: 0, to: 0, sound: "laser", reason: "x", confidence: 0.5 },
          { type: "sound", from: 0, to: 1, sound: "pop", reason: "x", confidence: 0.5 },
          { type: "cleanup", from: 0, to: 0, sound: "pop", reason: "x", confidence: 0.5 },
          { type: "sound", from: 3, to: 3, sound: "ding", reason: "x", confidence: 0.9 },
          { type: "sound", from: 4, to: 4, sound: "pop", reason: "x", confidence: 0.6 },
          { type: "sound", from: 6, to: 6, sound: "whoosh", reason: "x", confidence: 0.6 },
          { type: "tighten", from: 6, to: 7, reason: "x", confidence: 0.6 },
        ],
      },
      ws,
      [source("a", 6)],
      counter("p"),
      [],
      ["pop", "ding", "whoosh"],
    );
    expect(errors[0]).toContain("a sound must set sound to an id from the sound effects list (pop, ding, whoosh)");
    expect(errors[1]).toContain("a sound lands on one word");
    expect(errors[2]).toContain("only sounds may set sound");
    expect(errors).toContainEqual(expect.stringContaining("proposal 4 (sound 4..4): within 1.5 seconds of a more confident sound"));
    expect(errors.at(-1)).toContain("sound at word 6: it sits on words another proposal cuts");
    expect(proposals.map((p) => [p.type, p.sound?.effect ?? null])).toEqual([
      ["sound", "ding"],
      ["tighten", null],
    ]);
  });
});

describe("music", () => {
  it("sets its level and ducking, and comes out, without undo steps", () => {
    expect(() => applyEdit(project(), { type: "music", volume: 0.3 }, counter("n"))).toThrow("There is no music");
    const withMusic = { ...project(), music: { path: "/m/song.mp3", name: "song.mp3", duration: 90, volume: 0.15, duck: true, prep: null } };
    const quieter = applyEdit(withMusic, { type: "music", volume: 0.08 }, counter("n"));
    expect(quieter.music).toMatchObject({ volume: 0.08, duck: true });
    expect(applyEdit(quieter, { type: "music", duck: false }, counter("n")).music).toMatchObject({ volume: 0.08, duck: false });
    const gone = applyEdit(quieter, { type: "remove-music" }, counter("n"));
    expect(gone.music).toBeNull();
    expect(gone.history.past).toHaveLength(0);
  });
});

describe("the library", () => {
  it("names and explains every effect, each once, with its hit inside the sound", () => {
    expect(new Set(soundIds).size).toBe(SOUND_EFFECTS.length);
    for (const e of SOUND_EFFECTS) {
      expect(e.id).toMatch(/^[a-z0-9-]+$/);
      expect(e.meaning.length).toBeGreaterThan(20);
      expect(e.hit).toBeGreaterThanOrEqual(0);
    }
  });
});
