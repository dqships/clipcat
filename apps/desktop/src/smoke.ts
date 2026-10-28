// A smoke run (CLIPCAT_SMOKE=1) opens the window hidden, waits for the UI to
// report its first screen, prints one JSON line and exits: 0 when the UI drew
// and the bundled tools ran, 1 when one didn't, 2 when the UI never drew.
// With CLIPCAT_SMOKE_IMPORT=<file> it also imports that file and waits for
// prep, transcription and silence analysis, then exports it as 9:16 with
// captions, a motion slide over its start (rendered in the hidden offscreen
// window, as a real export does) and a sound effect from the shipped
// library; a failed step is a 1, and so is an empty transcript when
// CLIPCAT_SMOKE_EXPECT_WORDS=1. The report says whether the face detector
// runs and how many frames had a face. CI runs this against the
// packaged app on macOS and Windows.

import { app } from "electron";
import { writeFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { defaultOverlay, overlayProposal, slideAsset, soundProposal } from "@clipcat/core";
import type { AiStatusValue, AppInfoValue, JobEventValue } from "@clipcat/ipc";
import type { JobQueue } from "./jobs/queue";
import type { ExportRunner } from "./pipeline/export";
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
  /** The speech engine that heard each source ("parakeet", "whisper.cpp"). */
  backends: string[];
  /** Sampled frames with a face, over all sources; null where nobody looked. */
  faces: number | null;
  /** Bytes in the exported video; 0 when the export failed. */
  exported: number;
  /** Whether the export rendered the slide's video. */
  slide: boolean;
  failed: string[];
  error?: string;
};

/** Failed job messages, collected from the queue's events during a smoke run. */
const failures: string[] = [];
export function recordSmokeJob(event: JobEventValue): void {
  if (event.state === "failed") failures.push(`${event.kind}: ${event.error ?? "failed"}`);
}

/** A designed slide, shown over the first two seconds, so the export renders it, and a whoosh at its start. */
const SMOKE_SLIDE = `<style>.t{position:absolute;left:8vw;top:30vh;font-size:12vw;animation:in var(--spring-duration) var(--spring) both}
.tape{position:absolute;left:8vw;top:45vh;width:40vw;height:2vh;background:var(--tape);transform-origin:left;animation:wipe .5s var(--spring) both .2s}
@keyframes in{from{opacity:0;transform:translateY(3vh)}}@keyframes wipe{from{transform:scaleX(0)}}</style><div class="t">Smoke</div><div class="tape"></div>`;

async function addSmokeExtras(store: ProjectStore, projectId: string): Promise<void> {
  await store.update(projectId, null, (p) => {
    const source = p.sources[0];
    if (!source) return;
    const end = Math.min(2, source.media.duration);
    const card = slideAsset("smoke-slide", "Smoke", "paper", end);
    card.slide!.html = SMOKE_SLIDE;
    card.prep = { preview: "", frames: [] };
    p.assets.push(card);
    p.proposals.push(
      overlayProposal({ id: "smoke-slide", sourceId: source.id, wordIds: [], reason: "", confidence: 1, status: "accepted" }, defaultOverlay([0, end], card.id, "full")),
      soundProposal({ id: "smoke-sound", sourceId: source.id, wordIds: [], reason: "", confidence: 1, status: "accepted" }, { at: 0.5, effect: "whoosh", volume: 0.7 }),
    );
  });
}

/** Exports with the packaged ffmpeg, encoder, caption fonts and sound effects; the size of the file, or 0. */
async function smokeExport(exporter: ExportRunner, projectId: string): Promise<number> {
  const out = join(app.getPath("temp"), `clipcat-smoke-${process.pid}.mp4`);
  try {
    await exporter.run(projectId, "9:16", out, { signal: new AbortController().signal, progress: () => {} });
    return (await stat(out)).size;
  } catch (e) {
    failures.push(`export: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}

export async function smokeImport(
  pipeline: ImportPipeline,
  exporter: ExportRunner,
  store: ProjectStore,
  queue: JobQueue,
  file: string,
): Promise<SmokeImport> {
  try {
    const created = await pipeline.import([file], null);
    await queue.idle(created.id);
    await addSmokeExtras(store, created.id);
    const exported = await smokeExport(exporter, created.id);
    const renders = await readdir(join(store.dir(created.id), "media", "assets", "smoke-slide")).catch(() => [] as string[]);
    const slide = renders.some((f) => /^render-1080x1920-.*\.mov$/.test(f));
    const p = await store.get(created.id);
    const words = p.transcript.length;
    return {
      // A machine without a text-to-speech voice imports a silent clip, so words are only required when asked for.
      ok:
        failures.length === 0 &&
        (words > 0 || process.env.CLIPCAT_SMOKE_EXPECT_WORDS !== "1") &&
        p.sources.every((s) => s.prep !== null) &&
        exported > 0 &&
        slide,
      words,
      text: p.transcript.map((w) => w.text).join(" ").slice(0, 300),
      span: words > 0 ? [p.transcript[0]!.start, p.transcript[words - 1]!.end] : null,
      pauses: p.proposals.filter((x) => x.type === "silence").flatMap((x) => x.cuts),
      backends: p.sources.map((s) => s.transcription?.backend ?? "none"),
      faces: p.sources.every((s) => s.faces === null) ? null : p.sources.reduce((n, s) => n + (s.faces?.length ?? 0), 0),
      exported,
      slide,
      failed: failures,
    };
  } catch (e) {
    return { ok: false, words: 0, text: "", span: null, pauses: [], backends: [], faces: null, exported: 0, slide: false, failed: failures, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * `ai` is reported, not required: CI has no signed-in Claude Code. Neither is
 * `faceDetector` (why there's none, or null), which CI checks per system.
 */
export function finishSmoke(result: { screen: string; info: AppInfoValue; ai: AiStatusValue; faceDetector: string | null; import?: SmokeImport }): void {
  const tools = [result.info.ffmpeg, result.info.whisper, result.info.parakeet ?? { available: true }];
  const ok = tools.every((t) => t.available) && (result.import?.ok ?? true);
  report({ ok, ...result });
  app.exit(ok ? 0 : 1);
}
