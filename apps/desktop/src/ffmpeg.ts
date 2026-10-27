// Where the bundled ffmpeg lives and whether it runs. Packaged builds carry
// it in Resources/ffmpeg; in development it comes from vendor/ffmpeg/<platform>-<arch>,
// filled by `npm run fetch:ffmpeg`.

import { execFile } from "node:child_process";
import { join } from "node:path";

export type Binary = "ffmpeg" | "ffprobe";

export type Locate = {
  packaged: boolean;
  resourcesPath: string;
  repoRoot: string;
  platform: NodeJS.Platform;
  arch: string;
};

export function binaryPath(name: Binary, at: Locate): string {
  const file = at.platform === "win32" ? `${name}.exe` : name;
  return at.packaged
    ? join(at.resourcesPath, "ffmpeg", file)
    : join(at.repoRoot, "vendor", "ffmpeg", `${at.platform}-${at.arch}`, file);
}

/** First line of `<binary> -version`, or null if it can't be run within 10 s. */
export function probeVersion(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(path, ["-hide_banner", "-version"], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null);
      const first = stdout.split(/\r?\n/, 1)[0]?.trim();
      resolve(first ? first.replace(/ Copyright.*$/, "") : null);
    });
  });
}
