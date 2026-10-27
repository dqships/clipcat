import { describe, expect, it } from "vitest";
import { prepArgs, progressFrom } from "./prep";

const out = { proxy: "/p/proxy.mp4", wav: "/p/audio.wav", waveform: "/p/waveform.png", thumbs: "/p/thumbs/thumb-%04d.jpg" };
const video = { duration: 60, width: 3840, height: 2160, fps: 29.97, vfr: true, videoCodec: "hevc", audioCodec: "aac" };

describe("prepArgs", () => {
  it("matches the golden plan for a video source on macOS", () => {
    expect(prepArgs("/in/take 1.mov", video, out, "h264_videotoolbox").join(" ")).toMatchInlineSnapshot(
      `"-hide_banner -nostdin -y -progress pipe:1 -nostats -i /in/take 1.mov -filter_complex [0:a:0]aformat=channel_layouts=mono,showwavespic=s=4000x120:colors=white[wave] -map 0:v:0 -map 0:a:0 -vf fps=30,scale=-2:720:flags=bilinear,format=yuv420p -c:v h264_videotoolbox -b:v 6M -allow_sw 1 -pix_fmt yuv420p -g 30 -c:a aac -b:a 128k -movflags +faststart /p/proxy.mp4 -map 0:a:0 -vn -ac 1 -ar 16000 -c:a pcm_s16le /p/audio.wav -map 0:v:0 -an -vf fps=1/5,scale=-2:180 -q:v 5 /p/thumbs/thumb-%04d.jpg -map [wave] -frames:v 1 -update 1 /p/waveform.png"`,
    );
  });

  it("gives audio-only files a black proxy frame", () => {
    const args = prepArgs("/in/voice.m4a", { ...video, width: 0, height: 0, videoCodec: null, fps: 0 }, out, "h264_mf");
    expect(args).toContain("lavfi");
    expect(args).toContain("-shortest");
    expect(args.slice(args.indexOf("-map"), args.indexOf("-map") + 4)).toEqual(["-map", "0:v", "-map", "1:a:0"]);
  });
});

describe("progressFrom", () => {
  it("reads out_time_us", () => {
    expect(progressFrom("out_time_us=30000000", 60)).toBeCloseTo(0.5);
    expect(progressFrom("frame=10", 60)).toBeNull();
  });
});
