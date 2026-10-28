import { describe, expect, it } from "vitest";
import { assetFrameArgs, assetKind, assetPreviewArgs, frameTimes, parseAssetProbe } from "./assets";

describe("b-roll media", () => {
  it("tells pictures from videos by their extension", () => {
    expect([assetKind("/a/B.JPG"), assetKind("/a/b.heic"), assetKind("/a/c.MOV"), assetKind("/a/d.pdf")]).toEqual(["image", "image", "video", null]);
  });

  it("reads a picture's size and a video's size and length", () => {
    expect(parseAssetProbe({ streams: [{ codec_type: "video", width: 800, height: 600 }] }, "image")).toEqual({ duration: 0, width: 800, height: 600 });
    expect(
      parseAssetProbe({ streams: [{ codec_type: "video", width: 1920, height: 1080 }, { codec_type: "audio" }], format: { duration: "12.5" } }, "video"),
    ).toEqual({ duration: 12.5, width: 1920, height: 1080 });
    // Cover art is not a video.
    expect(() => parseAssetProbe({ streams: [{ codec_type: "video", width: 600, height: 600, disposition: { attached_pic: 1 } }], format: { duration: "180" } }, "video")).toThrow(
      "no video",
    );
    expect(() => parseAssetProbe({ streams: [{ codec_type: "audio" }] }, "image")).toThrow("Couldn't read this picture.");
  });

  it("takes a video's frames from the middle of each third, in one pass", () => {
    expect(frameTimes(9)).toEqual([1.5, 4.5, 7.5]);
    const args = assetFrameArgs("/v/c.mov", "video", { duration: 9, width: 1920, height: 1080 }, ["f1.jpg", "f2.jpg", "f3.jpg"]);
    expect(args.join(" ")).toContain("-ss 1.500 -i /v/c.mov -ss 4.500 -i /v/c.mov -ss 7.500 -i /v/c.mov -map 0:v:0 -frames:v 1");
    expect(args.at(-1)).toBe("f3.jpg");
    const picture = assetFrameArgs("/p/a.png", "image", { duration: 0, width: 10, height: 10 }, ["f1.jpg"]);
    expect(picture.slice(-9)).toEqual(["-i", "/p/a.png", "-frames:v", "1", "-vf", "scale=512:512:force_original_aspect_ratio=decrease,format=yuvj420p", "-q:v", "4", "f1.jpg"]);
  });

  it("previews a video as silent 720p H.264 and a picture as a PNG", () => {
    const video = assetPreviewArgs("/v/c.mov", "video", "p.mp4", "libx264");
    expect(video).toEqual(expect.arrayContaining(["-an", "-movflags", "+faststart"]));
    expect(video.join(" ")).toContain("scale=-2:'2*trunc(min(720,ih)/2)'");
    expect(assetPreviewArgs("/p/a.heic", "image", "p.png", "libx264").slice(-4)).toEqual([
      "1",
      "-vf",
      "scale=2560:2560:force_original_aspect_ratio=decrease:flags=lanczos",
      "p.png",
    ]);
  });
});
