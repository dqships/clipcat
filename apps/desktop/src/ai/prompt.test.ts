import { describe, expect, it } from "vitest";
import { asset, source, words } from "@clipcat/core/fixtures";
import { analysisPrompt, describePrompt, numberedTranscript, orderedWords } from "./prompt";

const second = { ...source("b", 3, 1), name: "take2.mov" };
const first = { ...source("a", 9, 0), name: "take1.mov" };
// Listed out of order on purpose: numbering follows the recordings' order.
const project = {
  sources: [second, first],
  transcript: [...words("b", "and again"), ...words("a", "hello there"), ...words("a", "friends", 4)],
  brief: "",
  language: "en",
  assets: [],
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

describe("media for b-roll", () => {
  const drone = { ...asset("m1", "video", 12), name: "drone.mp4", description: "Aerial shot of a city at dusk" };
  const logo = { ...asset("m2", "image"), name: "logo.png", prep: null };

  it("lists the prepared media after the transcript, numbered for the agent", () => {
    const prompt = analysisPrompt({ ...project, assets: [logo, drone] });
    expect(prompt).toContain("## Media for b-roll\n[0] drone.mp4 (video, 12.0s): Aerial shot of a city at dusk\n\n## Sound effects\n[whoosh] A smooth sweep");
    expect(analysisPrompt(project)).not.toContain("Media for b-roll");
    expect(analysisPrompt(project)).toContain("[ding] A clear bell.");
  });

  it("tells the describer how many frames are each item's", () => {
    expect(describePrompt([drone, { ...asset("m3", "image"), name: "chart.png" }])).toBe(
      ["Describe these 2 items. The attached frames come in this order.", "", "[0] drone.mp4: video, 12.0s, 1 frame", "[1] chart.png: picture, 1 frame"].join("\n"),
    );
  });
});
