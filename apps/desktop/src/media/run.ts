// Runs ffmpeg with progress and cancellation.

import { spawn } from "node:child_process";
import { progressFrom } from "./prep";

export function runFfmpeg(
  ffmpeg: string,
  args: string[],
  opts: { duration: number; onProgress?: (fraction: number) => void; signal?: AbortSignal; cwd?: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { cwd: opts.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const abort = () => child.kill();
    opts.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        const p = progressFrom(line, opts.duration);
        if (p !== null) opts.onProgress?.(p);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      tail = (tail + chunk).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", abort);
      if (opts.signal?.aborted) return reject(new Error("cancelled"));
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited with ${code}: ${tail.trim().split("\n").slice(-4).join(" | ")}`));
    });
  });
}
