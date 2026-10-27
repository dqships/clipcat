import { describe, expect, it } from "vitest";
import { parseWhisper, whisperArgs, whisperProgress } from "./whisper";

describe("parseWhisper", () => {
  it("joins punctuation and contractions to their word and drops noise", () => {
    const words = parseWhisper(
      {
        transcription: [
          { offsets: { from: 0, to: 300 }, text: " I" },
          { offsets: { from: 300, to: 600 }, text: " don" },
          { offsets: { from: 600, to: 700 }, text: "'t" },
          { offsets: { from: 700, to: 1200 }, text: " know" },
          { offsets: { from: 1200, to: 1250 }, text: "." },
          { offsets: { from: 1300, to: 4000 }, text: " [BLANK_AUDIO]" },
          { offsets: { from: 4000, to: 4400 }, text: " Okay" },
        ],
      },
      "src1",
    );
    expect(words.map((w) => w.text)).toEqual(["I", "don't", "know.", "Okay"]);
    expect(words[2]).toMatchObject({ start: 0.7, end: 1.25 });
    expect(words.every((w) => w.sourceId === "src1")).toBe(true);
  });
});

describe("whisperArgs", () => {
  it("asks for one word per segment as JSON", () => {
    const args = whisperArgs({ model: "/m.bin", wav: "/a.wav", outBase: "/out/t", language: "en", threads: 4 });
    expect(args.join(" ")).toBe("-m /m.bin -f /a.wav -l en -t 4 -ml 1 -sow -oj -of /out/t -pp -np");
  });
});

describe("whisperProgress", () => {
  it("reads the progress callback line", () => {
    expect(whisperProgress("whisper_print_progress_callback: progress =  45%")).toBeCloseTo(0.45);
    expect(whisperProgress("whisper_init")).toBeNull();
  });
});
