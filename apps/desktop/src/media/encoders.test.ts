import { describe, expect, it } from "vitest";
import { type Encoder, candidates, encoderArgs, encoderTestArgs, lazyEncoder, pickEncoder } from "./encoders";

describe("encoders", () => {
  it("tries the GPU encoders on Windows, VideoToolbox on macOS", () => {
    expect(candidates("win32")).toEqual(["h264_nvenc", "h264_qsv", "h264_amf", "h264_mf"]);
    expect(candidates("darwin")).toEqual(["h264_videotoolbox"]);
    expect(candidates("linux")).toEqual([]);
  });

  it("keeps the first encoder that works, else libx264", async () => {
    const tried: Encoder[] = [];
    const works = (ok: Encoder[]) => async (e: Encoder) => {
      tried.push(e);
      return ok.includes(e);
    };
    expect(await pickEncoder("win32", works(["h264_amf", "h264_mf"]))).toBe("h264_amf");
    expect(tried).toEqual(["h264_nvenc", "h264_qsv", "h264_amf"]);
    expect(await pickEncoder("win32", async () => Promise.reject(new Error("no GPU")))).toBe("libx264");
    expect(await pickEncoder("linux", works(["h264_nvenc"]))).toBe("libx264");
  });

  it("probes once", async () => {
    let probes = 0;
    const encoder = lazyEncoder(async () => {
      probes++;
      return "h264_nvenc";
    });
    expect(await Promise.all([encoder(), encoder()])).toEqual(["h264_nvenc", "h264_nvenc"]);
    expect(probes).toBe(1);
  });

  it("gives each encoder the pixel format it takes, and tests it the way exports use it", () => {
    expect(encoderArgs("h264_qsv", "10M", true)).toEqual(expect.arrayContaining(["-c:v", "h264_qsv", "-pix_fmt", "nv12", "-profile:v", "high"]));
    expect(encoderArgs("libx264", "6M", false)).toEqual(["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"]);
    const test = encoderTestArgs("h264_nvenc");
    expect(test).toEqual(expect.arrayContaining(["-c:v", "h264_nvenc", "-f", "null", "-"]));
  });
});
