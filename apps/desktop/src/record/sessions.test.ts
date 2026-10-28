import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamCounts } from "../media/probe";
import { nativeArgs } from "./native";
import { RecordingSessions, finalExtension, finishArgs, rawExtension, recordingName } from "./sessions";

describe("recording names and formats", () => {
  it("keeps MediaRecorder's container and says what's in it", () => {
    expect(rawExtension("video/mp4;codecs=avc1,mp4a.40.2")).toBe(".mp4");
    expect(rawExtension("video/webm;codecs=vp9,opus")).toBe(".webm");
    expect(rawExtension("")).toBe(".webm");
    expect(finalExtension("/t/a.webm", true)).toBe(".mkv");
    expect(finalExtension("/t/a.webm", false)).toBe(".mka");
    expect(finalExtension("/t/a.mp4", false)).toBe(".m4a");
    expect(finalExtension("/t/a.mov", true)).toBe(".mov");
  });

  it("names a take by what it is and when, in a form that sorts", () => {
    const at = new Date(2026, 9, 28, 9, 5, 7);
    expect(recordingName("voice", at)).toBe("Voice take 2026-10-28 at 09.05.07");
    expect(recordingName("screen", at)).toBe("Screen recording 2026-10-28 at 09.05.07");
    expect(recordingName("camera", at)).toBe("Camera recording 2026-10-28 at 09.05.07");
  });

  it("copies one sound track and mixes several into one", () => {
    expect(finishArgs("in.webm", 1, "out.mkv")).toEqual(["-hide_banner", "-y", "-i", "in.webm", "-map", "0:v?", "-map", "0:a?", "-c", "copy", "out.mkv"]);
    const mixed = finishArgs("in.mov", 2, "out.mov");
    expect(mixed).toContain("[0:a:0][0:a:1]amix=inputs=2:duration=longest:normalize=0[a]");
    expect(mixed.slice(-3)).toEqual(["-movflags", "+faststart", "out.mov"]);
  });

  it("counts sound streams and ignores cover art as picture", () => {
    expect(streamCounts({ streams: [{ codec_type: "video" }, { codec_type: "audio" }, { codec_type: "audio" }] })).toEqual({ audio: 2, video: true });
    expect(streamCounts({ streams: [{ codec_type: "audio" }, { codec_type: "video", disposition: { attached_pic: 1 } }] })).toEqual({ audio: 1, video: false });
  });

  it("asks the macOS recorder for the display, the microphone by name and the computer's sound", () => {
    expect(nativeArgs({ displayId: "1", out: "/t/a.mov", mic: true, micName: "USB Mic", systemAudio: true, excludePid: 42 })).toEqual([
      "record",
      "--display",
      "1",
      "--out",
      "/t/a.mov",
      "--exclude-pid",
      "42",
      "--mic",
      "--mic-name",
      "USB Mic",
      "--system-audio",
    ]);
    expect(nativeArgs({ displayId: "2", out: "o", mic: false, micName: "USB Mic", systemAudio: false, excludePid: 1 })).not.toContain("--mic-name");
  });
});

describe("RecordingSessions", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clipcat-rec-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const sessions = (inspect = async () => ({ audio: 1, video: true })) => {
    const ffmpeg = vi.fn(async (args: string[]) => {
      // Stands in for the remux: copies the raw file to the output.
      writeFileSync(args.at(-1)!, readFileSync(args[args.indexOf("-i") + 1]!));
    });
    const s = new RecordingSessions({ tempDir: join(dir, "tmp"), outDir: join(dir, "Movies"), inspect, ffmpeg, now: () => new Date(2026, 9, 28, 9, 5, 7) });
    return { s, ffmpeg };
  };

  it("writes chunks in order and keeps the finished take in the movies folder", async () => {
    const { s, ffmpeg } = sessions();
    const token = await s.begin("camera", "video/webm;codecs=vp9,opus");
    await s.append(token, Buffer.from("one "));
    await s.append(token, Buffer.from("two"));
    const out = await s.end(token);
    expect(out).toBe(join(dir, "Movies", "Camera recording 2026-10-28 at 09.05.07.mkv"));
    expect(readFileSync(out, "utf8")).toBe("one two");
    expect(ffmpeg).toHaveBeenCalledOnce();
    expect(readdirSync(join(dir, "tmp"))).toEqual([]);
    await expect(s.append(token, Buffer.from("late"))).rejects.toThrow(/isn't running/);
  });

  it("refuses a take with no sound and cleans up", async () => {
    const { s, ffmpeg } = sessions(async () => ({ audio: 0, video: true }));
    const token = await s.begin("screen", "video/mp4");
    await s.append(token, Buffer.from("x"));
    await expect(s.end(token)).rejects.toThrow(/no sound/);
    expect(ffmpeg).not.toHaveBeenCalled();
    expect(readdirSync(join(dir, "tmp"))).toEqual([]);
  });

  it("stops a native recording before keeping it, and forgets one that never started", async () => {
    const { s } = sessions();
    const stop = vi.fn(async () => {});
    let raw = "";
    const token = await s.beginNative((path) => {
      raw = path;
      writeFileSync(path, "movie");
      return { started: Promise.resolve(), stop, kill: () => {} };
    });
    const out = await s.end(token);
    expect(stop).toHaveBeenCalledOnce();
    expect(out.endsWith("Screen recording 2026-10-28 at 09.05.07.mov")).toBe(true);
    expect(existsSync(raw)).toBe(false);

    await expect(
      s.beginNative((path) => {
        writeFileSync(path, "");
        return { started: Promise.reject(new Error("no access")), stop, kill: () => {} };
      }),
    ).rejects.toThrow("no access");
    expect(readdirSync(join(dir, "tmp"))).toEqual([]);
  });

  it("throws away a discarded take and everything still running at quit", async () => {
    const { s } = sessions();
    const kill = vi.fn();
    const a = await s.begin("voice", "audio/webm");
    await s.append(a, Buffer.from("x"));
    await s.beginNative(() => ({ started: Promise.resolve(), stop: async () => {}, kill }));
    await s.discard(a);
    await s.discard(a);
    await s.discardAll();
    expect(kill).toHaveBeenCalledOnce();
    expect(readdirSync(join(dir, "tmp"))).toEqual([]);
    expect(existsSync(join(dir, "Movies"))).toBe(false);
  });
});
