import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runFfmpeg } from "./run";

let dir: string | null = null;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

async function fakeFfmpeg(body: string): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "clipcat-run-"));
  const bin = join(dir, "ffmpeg");
  await writeFile(bin, `#!/bin/sh\n${body}\n`);
  await chmod(bin, 0o755);
  return bin;
}

describe.skipIf(process.platform === "win32")("runFfmpeg", () => {
  it("reads a progress line that arrives in two pieces as one", async () => {
    const bin = await fakeFfmpeg("printf 'out_time_us=1'; sleep 0.1; printf '5000000\\nprogress=continue\\n'");
    const seen: number[] = [];
    await runFfmpeg(bin, [], { duration: 30, onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([0.5]);
  });

  it("fails with ffmpeg's last words", async () => {
    const bin = await fakeFfmpeg("echo 'Invalid data found when processing input' >&2; exit 1");
    await expect(runFfmpeg(bin, [], { duration: 1 })).rejects.toThrow("ffmpeg exited with 1: Invalid data found when processing input");
  });
});
