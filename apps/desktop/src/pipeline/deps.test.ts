import { chmod, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JobContext } from "../jobs/queue";
import { realDeps, type Tools } from "./deps";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clipcat-deps-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function script(name: string, body: string): Promise<string> {
  const bin = join(dir, name);
  await writeFile(bin, `#!/bin/sh\n${body}\n`);
  await chmod(bin, 0o755);
  return bin;
}

/** whisper-cli stand-in: writes one word to <-of>.json. */
const fakeWhisper = () =>
  script(
    "whisper-cli",
    ['of=""; while [ $# -gt 0 ]; do [ "$1" = "-of" ] && of="$2"; shift; done', `echo '{"transcription":[{"offsets":{"from":0,"to":500},"text":" whisper"}]}' > "$of.json"`].join("\n"),
  );

/** clipcat-parakeet stand-in: one word, or a failure. */
const fakeParakeet = (ok: boolean) =>
  script(
    "clipcat-parakeet",
    ok
      ? ['out=""; while [ $# -gt 0 ]; do [ "$1" = "--output" ] && out="$2"; shift; done', `echo '{"model":"m","text":"","words":[{"text":"parakeet","start":0,"end":0.5}]}' > "$out"`].join("\n")
      : "echo 'needs macOS 14' >&2; exit 1",
  );

async function deps(parakeet: string | null) {
  // A whisper model on disk already, so nothing downloads.
  const model = join(dir, "ggml-base.bin");
  await writeFile(model, "");
  await truncate(model, 2_000_000);
  const tools: Tools = { ffmpeg: "", ffprobe: "", whisper: await fakeWhisper(), parakeet, modelsDir: dir, model: "base", encoder: async () => "libx264" };
  return realDeps(tools);
}

const labels: (string | undefined)[] = [];
const ctx: JobContext = { signal: new AbortController().signal, progress: (_f, label) => labels.push(label) };
const opts = (language: string) => ({ wav: "/a.wav", outBase: join(dir, "transcript"), language, label: "Transcribing talk" });

describe.skipIf(process.platform === "win32")("realDeps transcribe", () => {
  it("uses Parakeet for a language it knows", async () => {
    const heard = await (await deps(await fakeParakeet(true))).transcribe(opts("en"), ctx);
    expect(heard).toMatchObject({ backend: "parakeet", model: "parakeet-tdt-0.6b-v3" });
    expect(heard.json.transcription?.[0]?.text).toBe(" parakeet");
  });

  it("uses whisper for other languages, and where there is no Parakeet", async () => {
    expect(await (await deps(await fakeParakeet(true))).transcribe(opts("ja"), ctx)).toMatchObject({ backend: "whisper.cpp", model: "base" });
    expect(await (await deps(null)).transcribe(opts("en"), ctx)).toMatchObject({ backend: "whisper.cpp" });
  });

  it("falls back to whisper when Parakeet fails, and says why", async () => {
    const heard = await (await deps(await fakeParakeet(false))).transcribe(opts("en"), ctx);
    expect(heard.backend).toBe("whisper.cpp");
    expect(heard.fallback).toContain("needs macOS 14");
    expect(heard.json.transcription?.[0]?.text).toBe(" whisper");
    expect(labels.at(-1)).toBe("Transcribing talk");
  });
});
