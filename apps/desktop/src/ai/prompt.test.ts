import { describe, expect, it } from "vitest";
import { source, words } from "@clipcat/core/fixtures";
import { analysisPrompt, numberedTranscript, orderedWords } from "./prompt";

const second = { ...source("b", 3, 1), name: "take2.mov" };
const first = { ...source("a", 9, 0), name: "take1.mov" };
// Listed out of order on purpose: numbering follows the recordings' order.
const project = {
  sources: [second, first],
  transcript: [...words("b", "and again"), ...words("a", "hello there"), ...words("a", "friends", 4)],
  brief: "",
  language: "en",
};

describe("numberedTranscript", () => {
  it("numbers words across recordings in order and writes the pauses in", () => {
    expect(numberedTranscript(project)).toBe(
      [
        "## Recording 1 of 2: take1.mov (9.0s)",
        "@0.0s [0]hello [1]there",
        "(pause 2.9s)",
        "@4.0s [2]friends",
        "## Recording 2 of 2: take2.mov (3.0s)",
        "@0.0s [3]and [4]again",
      ].join("\n"),
    );
    expect(orderedWords(project).map((w) => w.text)).toEqual(["hello", "there", "friends", "and", "again"]);
  });

  it("leads with the brief, or says there is none", () => {
    expect(analysisPrompt(project)).toMatch(/^The user gave no brief/);
    expect(analysisPrompt({ ...project, brief: "  Keep the joke  " })).toMatch(/^The user's brief:\nKeep the joke\n/);
  });
});
