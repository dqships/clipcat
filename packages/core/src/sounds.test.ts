import { describe, expect, it } from "vitest";
import { applyEdit } from "./editor";
import { counter, source, words } from "./fixtures";
import { initialSegments, setRange } from "./edits";
import { type MusicTrack, Project, type Proposal } from "./project";
import { validateProposals } from "./proposals";
import { MUSIC, SOUND_EFFECTS, musicAt, musicFade, musicProposal, musicTime, soundIds, soundProposal, timedMusic, timedSounds } from "./sounds";
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
  it("lands an effect on a word as one undo step, and sets its volume as another", () => {
    const p = applyEdit(project(), { type: "sound", wordId: "a-w3", effect: "pop" }, counter("n"));
    const added = p.proposals.at(-1)!;
    expect(added).toMatchObject({ type: "sound", status: "accepted", wordIds: ["a-w3"], sound: { at: ws[3]!.start, effect: "pop", volume: 0.7 } });
    expect(p.history.past).toHaveLength(1);
    const louder = applyEdit(p, { type: "sound-volume", id: added.id, volume: 1 }, counter("n"));
    expect(louder.proposals.at(-1)!.sound!.volume).toBe(1);
    expect(louder.history.past).toHaveLength(2);
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
  const track = (id: string, fields: Partial<MusicTrack> = {}): MusicTrack => ({ id, path: `/m/${id}.mp3`, name: `${id}.mp3`, duration: 90, volume: 0.15, duck: true, prep: null, description: "", whole: false, ...fields });

  it("reads a project saved with one track, or none", () => {
    const saved = { ...project(), music: { path: "/m/song.mp3", name: "song.mp3", duration: 90, volume: 0.3, duck: false, prep: "media/music/a.m4a" } };
    expect(Project.parse(saved).music).toEqual([{ id: "t1", path: "/m/song.mp3", name: "song.mp3", duration: 90, volume: 0.3, duck: false, prep: "media/music/a.m4a", description: "", whole: true }]);
    expect(Project.parse({ ...project(), music: null }).music).toEqual([]);
  });

  it("sets a track's level, ducking and description, and takes it out, as undo steps", () => {
    expect(() => applyEdit(project(), { type: "music", volume: 0.3 }, counter("n"))).toThrow("There is no music");
    const withMusic = { ...project(), music: [track("t1", { whole: true })] };
    const quieter = applyEdit(withMusic, { type: "music", volume: 0.08 }, counter("n"));
    expect(quieter.music[0]).toMatchObject({ volume: 0.08, duck: true });
    expect(applyEdit(quieter, { type: "music", id: "t1", duck: false, description: "Soft piano" }, counter("n")).music[0]).toMatchObject({ volume: 0.08, duck: false, description: "Soft piano" });
    const gone = applyEdit(quieter, { type: "remove-music" }, counter("n"));
    expect(gone.music).toEqual([]);
    expect(gone.history.past).toHaveLength(2);
  });

  it("asks which track when there are several, and lets one play under the whole video", () => {
    const two = { ...project(), music: [track("t1", { whole: true }), track("t2")] };
    expect(() => applyEdit(two, { type: "music", volume: 0.3 }, counter("n"))).toThrow("Say which music track");
    expect(() => applyEdit(two, { type: "music", id: "t9", volume: 0.3 }, counter("n"))).toThrow("Unknown music");
    expect(applyEdit(two, { type: "music", id: "t2", whole: true }, counter("n")).music.map((t) => t.whole)).toEqual([false, true]);
  });

  it("places a track over words as one undo step, and taking the track out takes its placements", () => {
    const two = { ...project(), music: [track("t1"), track("t2")] };
    expect(() => applyEdit(two, { type: "place-music", wordIds: ["a-w3"], trackId: "t9" }, counter("n"))).toThrow("Unknown music");
    const placed = applyEdit(two, { type: "place-music", wordIds: ["a-w3", "a-w4"], trackId: "t2" }, counter("n"));
    expect(placed.proposals.at(-1)).toMatchObject({ type: "music", status: "accepted", wordIds: ["a-w3", "a-w4"], cuts: [], music: { trackId: "t2" } });
    expect(placed.history.past).toHaveLength(1);
    expect(applyEdit(placed, { type: "remove-music", id: "t2" }, counter("n")).proposals.filter((p) => p.music)).toEqual([]);
  });

  const placement = (id: string, range: [number, number], trackId: string, status: Proposal["status"] = "accepted") =>
    musicProposal({ id, sourceId: "a", wordIds: ["a-w3"], reason: "", confidence: 1, status }, { range, trackId });
  const timed = (music: MusicTrack[], proposals: Proposal[]) => {
    const p = { ...project(), segments: initialSegments("a", 20, counter("s")), sources: [source("a", 20)], music, proposals };
    return timedMusic(p, buildTimeline(p));
  };

  it("plays the whole-video track end to end, fading out at the end", () => {
    const [m, ...rest] = timed([track("t1", { whole: true })], []);
    expect(rest).toEqual([]);
    expect(m).toMatchObject({ start: 0, end: 20, offset: 0, fadeIn: MUSIC.fadeIn, fadeOut: MUSIC.fadeOut });
  });

  it("lets placed tracks take over from the whole-video track, which picks up on the output clock", () => {
    const list = timed([track("t1", { whole: true }), track("t2")], [placement("m1", [5, 10], "t2"), placement("m2", [12, 12.5], "t9"), placement("m3", [15, 18], "t1", "pending")]);
    expect(list.map((m) => [m.track.id, m.start, m.end, m.offset])).toEqual([
      ["t1", 0, 5, 0],
      ["t2", 5, 10, 0],
      ["t1", 10, 20, 10],
    ]);
    expect(list[0]!.fadeOut).toBe(MUSIC.handover);
    expect(musicAt(list, 7)?.track.id).toBe("t2");
    expect(musicTime(list[1]!, 7)).toBe(2);
    expect(musicTime(list[2]!, 12)).toBe(12);
    expect(musicFade(list[1]!, 5)).toBe(0);
    expect(musicFade(list[1]!, 7)).toBe(1);
  });

  it("plays only what's placed when no track plays throughout, and never two at once", () => {
    const list = timed([track("t1"), track("t2")], [placement("m1", [2, 8], "t1"), placement("m2", [6, 12], "t2")]);
    expect(list.map((m) => [m.track.id, m.start, m.end])).toEqual([
      ["t1", 2, 6],
      ["t2", 6, 12],
    ]);
    expect(musicAt(list, 15)).toBeNull();
  });

  it("loops a track shorter than its stretch", () => {
    const [m] = timed([track("t1", { duration: 3, whole: true })], []);
    expect(musicTime(m!, 7)).toBe(1);
  });

  it("checks the AI editor's placements against the track list", () => {
    const long = words("a", Array.from({ length: 30 }, (_, i) => `w${i}`).join(" "));
    const ask = (p: object) => validateProposals({ proposals: [{ reason: "Mood shift", confidence: 0.9, ...p }] as never }, long, [source("a", 20)], counter("n"), [], [], [{ id: "t1" }, { id: "t2" }]);
    const ok = ask({ type: "music", from: 2, to: 20, track: 1 });
    expect(ok.errors).toEqual([]);
    expect(ok.proposals[0]).toMatchObject({ type: "music", status: "pending", cuts: [], music: { trackId: "t2", range: [long[2]!.start, long[20]!.end] } });
    expect(ask({ type: "music", from: 2, to: 20, track: 5 }).errors[0]).toContain("music must set track to a number from the music list (0..1)");
    expect(ask({ type: "music", from: 2, to: 3, track: 0 }).errors[0]).toContain("music covers at least");
    expect(ask({ type: "cleanup", from: 2, to: 3, track: 0 }).errors[0]).toContain("only music may set track");
  });

  it("keeps the more confident of two tracks over the same words", () => {
    const long = words("a", Array.from({ length: 30 }, (_, i) => `w${i}`).join(" "));
    const base = { type: "music" as const, reason: "x" };
    const { proposals, errors } = validateProposals(
      { proposals: [{ ...base, from: 0, to: 15, track: 0, confidence: 0.5 }, { ...base, from: 10, to: 25, track: 1, confidence: 0.9 }] },
      long, [source("a", 20)], counter("n"), [], [], [{ id: "t1" }, { id: "t2" }],
    );
    expect(proposals.map((p) => p.music?.trackId)).toEqual(["t2"]);
    expect(errors[0]).toContain("overlaps a more confident proposal");
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
