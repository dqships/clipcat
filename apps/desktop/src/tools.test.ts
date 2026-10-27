import { describe, expect, it } from "vitest";
import { binaryPath } from "./tools";

const base = { resourcesPath: "/Applications/ClipCat.app/Contents/Resources", repoRoot: "/repo" };

describe("binaryPath", () => {
  it("finds the packaged binary in Resources/bin", () => {
    expect(binaryPath("ffmpeg", { ...base, packaged: true, platform: "darwin", arch: "arm64" })).toBe(
      "/Applications/ClipCat.app/Contents/Resources/bin/ffmpeg",
    );
  });

  it("adds .exe on Windows", () => {
    expect(binaryPath("ffprobe", { ...base, packaged: true, platform: "win32", arch: "x64" })).toMatch(/ffprobe\.exe$/);
  });

  it("uses vendor/bin/<platform>-<arch> in development", () => {
    expect(binaryPath("ffmpeg", { ...base, packaged: false, platform: "darwin", arch: "arm64" })).toBe(
      "/repo/vendor/bin/darwin-arm64/ffmpeg",
    );
  });
});
