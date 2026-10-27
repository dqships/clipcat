import { describe, expect, it } from "vitest";
import { encodeWav, parseWav } from "./wav";

describe("wav", () => {
  it("round-trips samples", () => {
    const samples = Float32Array.from({ length: 1600 }, (_, i) => Math.sin(i / 10) * 0.5);
    const pcm = parseWav(encodeWav(samples, 16000));
    expect(pcm.sampleRate).toBe(16000);
    expect(pcm.samples).toHaveLength(1600);
    expect(pcm.samples[37]).toBeCloseTo(samples[37]!, 3);
  });

  it("accepts a streamed data size", () => {
    const buf = encodeWav(new Float32Array(100), 16000);
    buf.writeUInt32LE(0xffffffff, 40);
    expect(parseWav(buf).samples).toHaveLength(100);
  });

  it("refuses other files", () => {
    expect(() => parseWav(Buffer.from("not a wav file at all, no"))).toThrow();
  });
});
