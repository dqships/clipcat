// A smoke run (CLIPCAT_SMOKE=1) opens the window hidden, waits for the UI to
// report its first screen, prints one JSON line and exits: 0 when the UI drew
// and the bundled ffmpeg ran, 1 when ffmpeg didn't, 2 when the UI never drew.
// CI runs this against the packaged app on macOS and Windows.

import { app } from "electron";
import { writeFileSync } from "node:fs";
import type { AppInfoValue } from "@clipcat/ipc";

const TIMEOUT_MS = 60_000;

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

export function finishSmoke(result: { screen: string; info: AppInfoValue }): void {
  const ok = result.info.ffmpeg.available;
  report({ ok, ...result });
  app.exit(ok ? 0 : 1);
}
