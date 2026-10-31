import { describe, expect, it } from "vitest";
import { initialSegments, setRange } from "./edits";
import { applyEdit } from "./editor";
import { counter, source, words } from "./fixtures";
import { Project } from "./project";
import { buildTimeline } from "./timeline";
import { chapterTime, postText, timedChapters, validateWriteup } from "./writeup";

const ws = words("a", Array.from({ length: 200 }, (_, i) => `w${i}`).join(" "));

/** 120 s of talk with 6 s (words 10 to 19) cut. */
function project() {
  const id = counter("s");
  return Project.parse({
    version: 1, id: "p", name: "p", revision: 0, sources: [source("a", 120)], transcript: ws,
    segments: setRange(initialSegments("a", 120, id), "a", [ws[10]!.start, ws[20]!.start], false, id),
    proposals: [], captions: {}, createdAt: "", updatedAt: "",
  });
}

const article = { title: "On words", markdown: "# On words\n\nThey matter." };

describe("validateWriteup", () => {
  it("keeps chapters on words still in, in order and far enough apart, the first at 0:00", () => {
    const p = project();
    const { writeup, errors } = validateWriteup(
      {
        chapters: [
          { word: 1, title: " Intro " },
          { word: 12, title: "Cut words" },
          { word: 25, title: "Too soon" },
          { word: 60, title: "Middle" },
          { word: 40, title: "Backwards" },
          { word: 150, title: "End" },
          { word: 999, title: "Nowhere" },
        ],
        description: " About words. ",
        article,
      },
      ws,
      p,
      buildTimeline(p),
    );
    expect(writeup.chapters).toEqual([
      { wordId: "a-w1", title: "Intro" },
      { wordId: "a-w60", title: "Middle" },
      { wordId: "a-w150", title: "End" },
    ]);
    expect(writeup.description).toBe("About words.");
    expect(errors).toEqual([
      expect.stringContaining('chapter 1 ("Cut words"): word 12 is cut'),
      expect.stringContaining('chapter 2 ("Too soon"): starts 9.0 s after'),
      expect.stringContaining('chapter 4 ("Backwards")'),
      'chapter 6 ("Nowhere"): word must be a number from 0 to 199',
    ]);
  });

  it("asks for three chapters on a long video, and none on a short one", () => {
    const p = project();
    const one = validateWriteup({ chapters: [{ word: 0, title: "All" }], description: "", article }, ws, p, buildTimeline(p));
    expect(one.errors).toEqual(["give at least 3 chapters, the first on the first word that is still in"]);
    const short = { ...p, segments: setRange(p.segments, "a", [50, 120], false, counter("x")) };
    const none = validateWriteup({ chapters: [{ word: 0, title: "All" }], description: "", article }, ws, short, buildTimeline(short));
    expect(none.writeup.chapters).toEqual([]);
    expect(none.errors).toEqual(["the video is under 60 s long: give no chapters"]);
  });
});

describe("chapters on the edit", () => {
  it("follow their words, move to the next word in when theirs is cut, and start the video at 0:00", () => {
    let p = project();
    for (const [wordId, title] of [["a-w5", "Start"], ["a-w15", "Was cut"], ["a-w100", "Later"], ["a-w21", "Same place"]] as const) {
      p = applyEdit(p, { type: "chapter", wordId, title }, counter("n"));
    }
    const timeline = buildTimeline(p);
    const timed = timedChapters(p, timeline);
    // "Was cut" lands on word 20, the first word in after the cut; "Same place" lands 0.6 s later and stays.
    expect(timed.map((c) => [c.title, Number(c.start.toFixed(2))])).toEqual([
      ["Start", 0],
      ["Was cut", 6],
      ["Same place", 6.6],
      ["Later", 54],
    ]);
    expect(postText("Words.", timed)).toBe("Words.\n\n0:00 Start\n0:06 Was cut\n0:06 Same place\n0:54 Later");
    expect(postText("Words.", timed.slice(0, 2))).toBe("Words.");

    const renamed = applyEdit(p, { type: "chapter", wordId: "a-w100", title: "Last" }, counter("n"));
    expect(renamed.writeup!.chapters.find((c) => c.wordId === "a-w100")!.title).toBe("Last");
    const fewer = applyEdit(renamed, { type: "remove-chapter", wordId: "a-w15" }, counter("n"));
    expect(fewer.writeup!.chapters).toHaveLength(3);
    expect(fewer.history.past).toHaveLength(6);
    expect(() => applyEdit(fewer, { type: "remove-chapter", wordId: "a-w15" }, counter("n"))).toThrow("Unknown chapter");
    expect(() => applyEdit(fewer, { type: "chapter", wordId: "nope", title: "x" }, counter("n"))).toThrow("Unknown words");
  });

  it("edits the description and article, starting a write-up if there is none", () => {
    const p = applyEdit(project(), { type: "writeup", description: "New", article: "Body" }, counter("n"));
    expect(p.writeup).toEqual({ chapters: [], description: "New", article: { title: "", markdown: "Body" } });
  });

  it("writes timestamps the way YouTube reads them", () => {
    expect([chapterTime(0), chapterTime(65.9), chapterTime(3725)]).toEqual(["0:00", "1:05", "1:02:05"]);
  });
});
