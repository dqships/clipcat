import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parakeetArgs, parakeetProgress, parakeetSegments, runParakeet, type ParakeetProgress } from "./parakeet";
import { parseWhisper } from "./whisper";

let dir: string | null = null;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

/** A stand-in for clipcat-parakeet: a shell script that prints `stdout` and runs `body`. */
async function fakeHelper(body: string): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "clipcat-parakeet-"));
  const bin = join(dir, "clipcat-parakeet");
  await writeFile(bin, `#!/bin/sh\n${body}\n`);
  await chmod(bin, 0o755);
  return bin;
}

describe("parakeetSegments", () => {
  it("turns the helper's words into segments the whisper parser reads, one word each", () => {
    const json = parakeetSegments({
      model: "parakeet-tdt-0.6b-v3",
      text: "Hello, world.",
      words: [
        { text: "Hello,", start: 0.24, end: 0.56 },
        { text: " ", start: 0.56, end: 0.6 },
        { text: "world.", start: 0.64, end: 0.6 },
      ],
    });
    expect(json.transcription).toEqual([
      { offsets: { from: 240, to: 560 }, text: " Hello," },
      { offsets: { from: 640, to: 640 }, text: " world." },
    ]);
    expect(parseWhisper(json, "s").map((w) => [w.text, w.start, w.end])).toEqual([
      ["Hello,", 0.24, 0.56],
      ["world.", 0.64, 0.64],
    ]);
  });
});

describe("parakeetProgress", () => {
  it("reads the helper's progress lines and nothing else", () => {
    expect(parakeetProgress("phase=downloading progress=0.2500")).toEqual({ phase: "downloading", fraction: 0.25 });
    expect(parakeetProgress("phase=transcribing progress=1.0000\r")).toEqual({ phase: "transcribing", fraction: 1 });
    expect(parakeetProgress("Loading models")).toBeNull();
  });
});

describe("parakeetArgs", () => {
  it("keeps the models in their own folder", () => {
    expect(parakeetArgs({ modelsDir: "/m", wav: "/a.wav", out: "/o.json" })).toEqual([
      "transcribe", "--models", join("/m", "parakeet"), "--input", "/a.wav", "--output", "/o.json",
    ]);
  });
});

describe.skipIf(process.platform === "win32")("runParakeet", () => {
  it("passes progress on and reads the words it wrote", async () => {
    const bin = await fakeHelper(
      [
        'out=""; while [ $# -gt 0 ]; do [ "$1" = "--output" ] && out="$2"; shift; done',
        "echo phase=downloading progress=0.5000",
        "printf 'phase=transcribing progress=0.'; printf '7500\\n'",
        `echo '{"model":"parakeet-tdt-0.6b-v3","text":"Hi.","words":[{"text":"Hi.","start":0.1,"end":0.4}]}' > "$out"`,
      ].join("\n"),
    );
    const seen: ParakeetProgress[] = [];
    const json = await runParakeet({
      binary: bin,
      modelsDir: dir!,
      wav: "/a.wav",
      outBase: join(dir!, "transcript"),
      onProgress: (p) => seen.push(p),
      signal: new AbortController().signal,
    });
    expect(seen).toEqual([
      { phase: "downloading", fraction: 0.5 },
      { phase: "transcribing", fraction: 0.75 },
    ]);
    expect(json.transcription).toEqual([{ offsets: { from: 100, to: 400 }, text: " Hi." }]);
  });

  it("fails with the helper's last words", async () => {
    const bin = await fakeHelper("echo 'clipcat-parakeet: the Neural Engine is busy' >&2; exit 1");
    await expect(
      runParakeet({ binary: bin, modelsDir: dir!, wav: "/a.wav", outBase: join(dir!, "t"), onProgress: () => {}, signal: new AbortController().signal }),
    ).rejects.toThrow("clipcat-parakeet exited with 1: clipcat-parakeet: the Neural Engine is busy");
  });
});
