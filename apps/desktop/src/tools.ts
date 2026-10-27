// Where the bundled command-line tools live and whether they run. Packaged
// builds carry them in Resources/bin; in development they come from
// vendor/bin/<platform>-<arch>, filled by `npm run fetch:ffmpeg`,
// `npm run build:whisper` and, on Apple Silicon, `npm run build:parakeet`.

import { execFile } from "node:child_process";
import { join } from "node:path";

export type Binary = "ffmpeg" | "ffprobe" | "whisper-cli" | "clipcat-parakeet";

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
    ? join(at.resourcesPath, "bin", file)
    : join(at.repoRoot, "vendor", "bin", `${at.platform}-${at.arch}`, file);
}

/** The whisper.cpp release scripts/build-whisper.mjs builds; whisper-cli has no version flag to ask. */
export const WHISPER_RELEASE = "whisper.cpp v1.9.4";

/**
 * A one-line version for a bundled tool, or null if it can't be run within
 * 10 s: the first line of `ffmpeg -version` or `clipcat-parakeet --version`,
 * or the pinned release for a whisper-cli that answers `--help`.
 */
export function probeVersion(path: string): Promise<string | null> {
  const whisper = /whisper-cli(\.exe)?$/.test(path);
  const args = whisper ? ["--help"] : /clipcat-parakeet$/.test(path) ? ["--version"] : ["-hide_banner", "-version"];
  return new Promise((resolve) => {
    execFile(path, args, { timeout: 10_000, windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null);
      if (whisper) return resolve(WHISPER_RELEASE);
      const first = stdout.split(/\r?\n/, 1)[0]?.trim();
      resolve(first ? first.replace(/ Copyright.*$/, "") : null);
    });
  });
}
