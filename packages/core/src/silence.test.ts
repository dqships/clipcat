import { describe, expect, it } from "vitest";
import { counter, words } from "./fixtures";
import {
  HANDLE,
  detectSilence,
  frameLevels,
  fromSpeechTime,
  quietRanges,
  silenceProposals,
  silenceThreshold,
  speechSpans,
  trimStretchedWords,
} from "./silence";

const RATE = 16000;

/** Speech-like noise at `db` for each [start, end] range, quiet hiss elsewhere. */
function synth(duration: number, loud: [number, number][], db = -18): Float32Array {
  const out = new Float32Array(Math.round(duration * RATE));
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const amp = (d: number) => 10 ** (d / 20) * Math.SQRT2 * 1.7;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const on = loud.some(([a, b]) => t >= a && t < b);
    out[i] = noise() * amp(on ? db : -70);
  }
  return out;
}

describe("silence", () => {
  it("adapts the threshold to the recording", () => {
    const levels = frameLevels(synth(10, [[0, 8]]), RATE);
    const t = silenceThreshold(levels);
    expect(t).toBeLessThanOrEqual(-42);
    expect(t).toBeGreaterThanOrEqual(-60);
  });

  it("finds the pause between two phrases", () => {
    const ranges = detectSilence(frameLevels(synth(6, [[0.5, 2], [4, 5.5]]), RATE));
    const middle = ranges.find(([a, b]) => a > 1.5 && b < 4.5);
    expect(middle?.[0]).toBeCloseTo(2, 1);
    expect(middle?.[1]).toBeCloseTo(4, 1);
  });

  it("never covers a word, even a quiet one", () => {
    const ranges = detectSilence(frameLevels(synth(6, [[0.5, 2], [4, 5.5]]), RATE), [{ start: 2.9, end: 3.1 }]);
    for (const [a, b] of ranges) expect(b <= 2.9 || a >= 3.1).toBe(true);
  });

  it("cuts back a word whisper stretched across the pause", () => {
    const levels = frameLevels(synth(6, [[0.5, 2], [4, 5.5]]), RATE);
    const quiet = quietRanges(levels);
    const ws = [
      { start: 1.6, end: 4, text: "wrong," },
      { start: 4, end: 4.3, text: "This" },
      { start: 2.9, end: 3.1, text: "quiet" },
    ];
    const [wrong, ...rest] = trimStretchedWords(ws, quiet);
    expect(wrong!.end).toBeCloseTo(2, 1);
    expect(rest).toEqual(ws.slice(1));
    const ranges = detectSilence(levels, [wrong!, ws[1]!]);
    expect(ranges.some(([a, b]) => a < 2.2 && b > 3.8)).toBe(true);
  });

  it("takes long pauses out of the audio whisper hears, keeping a little quiet", () => {
    const spans = speechSpans([[0, 0.4], [2, 4.5], [5, 5.5], [9, 10]], 10);
    expect(spans).toEqual([
      [0, 2.2],
      [4.3, 9.2],
    ]);
    expect(speechSpans([[0, 10]], 10)).toEqual([[0, 10]]);
  });

  it("maps speech-audio times back onto the recording", () => {
    const spans: [number, number][] = [
      [0, 2.2],
      [4.3, 10],
    ];
    expect(fromSpeechTime(1, spans, "start")).toBeCloseTo(1);
    expect(fromSpeechTime(2.2, spans, "end")).toBeCloseTo(2.2);
    expect(fromSpeechTime(2.2, spans, "start")).toBeCloseTo(4.3);
    expect(fromSpeechTime(3, spans, "start")).toBeCloseTo(5.1);
    expect(fromSpeechTime(99, spans, "end")).toBe(10);
  });

  it("proposes long pauses with handles, skips short ones", () => {
    const ws = [...words("a", "one two", 0.5), ...words("a", "three", 3.6), ...words("a", "four", 4.2)];
    const props = silenceProposals("a", [[1.6, 3.6], [4.1, 4.2]], ws, 6, counter());
    expect(props).toHaveLength(1);
    expect(props[0]!.cuts[0]![0]).toBeCloseTo(1.6 + HANDLE);
    expect(props[0]!.cuts[0]![1]).toBeCloseTo(3.6 - HANDLE);
  });

  it("trims dead air at the start and end of the recording", () => {
    const ws = words("a", "hello there", 2);
    const props = silenceProposals("a", [[0, 2], [3.1, 6]], ws, 6, counter());
    expect(props.map((p) => p.cuts[0])).toEqual([
      [0, expect.closeTo(2 - HANDLE)],
      [expect.closeTo(3.1 + HANDLE), 6],
    ]);
  });
});
