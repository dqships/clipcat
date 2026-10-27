import { describe, expect, it } from "vitest";
import { parseProbe } from "./probe";

describe("parseProbe", () => {
  it("reads a phone recording and flags variable frame rate", () => {
    const info = parseProbe({
      format: { duration: "61.5" },
      streams: [
        { codec_type: "video", codec_name: "hevc", width: 1920, height: 1080, r_frame_rate: "30/1", avg_frame_rate: "2876/100" },
        { codec_type: "audio", codec_name: "aac" },
      ],
    });
    expect(info).toEqual({ duration: 61.5, width: 1920, height: 1080, fps: 28.76, vfr: true, videoCodec: "hevc", audioCodec: "aac" });
  });

  it("treats cover art as no video", () => {
    const info = parseProbe({
      format: { duration: "10" },
      streams: [
        { codec_type: "audio", codec_name: "mp3" },
        { codec_type: "video", codec_name: "mjpeg", width: 600, height: 600, disposition: { attached_pic: 1 } },
      ],
    });
    expect(info.videoCodec).toBeNull();
  });

  it("refuses files without audio", () => {
    expect(() => parseProbe({ format: { duration: "5" }, streams: [{ codec_type: "video" }] })).toThrow(/no audio/);
  });
});
