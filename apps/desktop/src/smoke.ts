// A smoke run (CLIPCAT_SMOKE=1) opens the window hidden, waits for the UI to
// report its first screen, prints one JSON line and exits: 0 when the UI drew
// and the bundled tools ran, 1 when one didn't, 2 when the UI never drew.
// With CLIPCAT_SMOKE_IMPORT=<file> it also imports that file and waits for
// prep, transcription and silence analysis; a failed step is a 1, and so is
// an empty transcript when CLIPCAT_SMOKE_EXPECT_WORDS=1. CI runs this against the packaged app on macOS and Windows.

import { app } from "electron";
import { writeFileSync } from "node:fs";
import type { AppInfoValue, JobEventValue } from "@clipcat/ipc";
import type { JobQueue } from "./jobs/queue";
import type { ImportPipeline } from "./pipeline/import";
import type { ProjectStore } from "./store/projects";

/** Long enough for a first-run model download and a CPU-only transcription in CI. */
const TIMEOUT_MS = 15 * 60_000;

export const isSmokeRun = (): boolean => process.env.CLIPCAT_SMOKE === "1";

/** Prints the result and, when CLIPCAT_SMOKE_OUT is set, writes it there too (Windows GUI apps may have no stdout). */
function report(result: object): void {
  const line = JSON.stringify(result);
  process.stdout.write(`CLIPCAT_SMOKE ${line}\n`);
  const out = process.env.CLIPCAT_SMOKE_OUT;
  if (out) writeFileSync(out, line);
}

export function startSmokeTimer(): void {
  setTimeout(() => {
    report({ ok: false, reason: "ui-timeout" });
    app.exit(2);
  }, TIMEOUT_MS).unref();
}

export type SmokeImport = {
  ok: boolean;
  words: number;
  text: string;
  /** Source seconds of the first and last word, to see whether speech at either end was missed. */
  span: [number, number] | null;
  pauses: [number, number][];
  failed: string[];
  error?: string;
};

/** Failed job messages, collected from the queue's events during a smoke run. */
const failures: string[] = [];
export function recordSmokeJob(event: JobEventValue): void {
  if (event.state === "failed") failures.push(`${event.kind}: ${event.error ?? "failed"}`);
}

export async function smokeImport(pipeline: ImportPipeline, store: ProjectStore, queue: JobQueue, file: string): Promise<SmokeImport> {
  try {
    const created = await pipeline.import([file], null);
    await queue.idle(created.id);
    const p = await store.get(created.id);
    const words = p.transcript.length;
    return {
      // A machine without a text-to-speech voice imports a silent clip, so words are only required when asked for.
      ok: failures.length === 0 && (words > 0 || process.env.CLIPCAT_SMOKE_EXPECT_WORDS !== "1") && p.sources.every((s) => s.prep !== null),
      words,
      text: p.transcript.map((w) => w.text).join(" ").slice(0, 300),
      span: words > 0 ? [p.transcript[0]!.start, p.transcript[words - 1]!.end] : null,
      pauses: p.proposals.filter((x) => x.type === "silence").flatMap((x) => x.cuts),
      failed: failures,
    };
  } catch (e) {
    return { ok: false, words: 0, text: "", span: null, pauses: [], failed: failures, error: e instanceof Error ? e.message : String(e) };
  }
}

export function finishSmoke(result: { screen: string; info: AppInfoValue; import?: SmokeImport }): void {
  const ok = result.info.ffmpeg.available && result.info.whisper.available && (result.import?.ok ?? true);
  report({ ok, ...result });
  app.exit(ok ? 0 : 1);
}
