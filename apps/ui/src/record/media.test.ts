import { describe, expect, it } from "vitest";
import { clock, pickMimeType } from "./media";

describe("pickMimeType", () => {
  it("prefers H.264 in MP4, then WebM, and records voice as sound only", () => {
    expect(pickMimeType("camera", () => true)).toBe("video/mp4;codecs=avc1,mp4a.40.2");
    expect(pickMimeType("screen", (t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9,opus");
    expect(pickMimeType("voice", (t) => t.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
    expect(pickMimeType("camera", () => false)).toBe("");
  });
});

describe("clock", () => {
  it("shows minutes and seconds, and hours once there", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(65.9)).toBe("1:05");
    expect(clock(3725)).toBe("1:02:05");
  });
});
