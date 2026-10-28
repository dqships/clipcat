// The subject cutout behind the thumbnail editor: the UI's cutout.html page
// (ISNet on ONNX Runtime's WebAssembly backend, both shipped with the app) in
// a hidden window of its own, like the face detector, so it runs offline and
// the same on macOS and Windows. It loads the model only when first needed.

import { BrowserWindow } from "electron";
import type { Cutout } from "./pipeline/thumbnail";

/** Waits for the model, so a page that loads but can't run it counts as missing. */
const PROBE = `(async () => {
  try {
    await window.clipcatCutout.ready;
    return null;
  } catch (e) {
    return String((e && e.message) || e);
  }
})()`;

let page: string | null = null;
let win: BrowserWindow | null = null;
let ready: Promise<string | null> | null = null;

/** Where cutout.html is served: the app's own origin, or the dev server. Set once at startup. */
export function setCutoutPage(url: string): void {
  page = url;
}

async function open(): Promise<string | null> {
  if (!page) return "The cutout's page isn't set";
  const w = new BrowserWindow({
    show: false,
    width: 64,
    height: 64,
    webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win = w;
  w.on("closed", () => {
    win = null;
    ready = null;
  });
  await w.loadURL(page);
  const problem = (await w.webContents.executeJavaScript(PROBE)) as string | null;
  if (problem) {
    w.removeAllListeners("closed");
    w.destroy();
    win = null;
  }
  return problem;
}

/** Why there's no cutout, or null when there is one. Opens the hidden window and loads the model on first use. */
export function cutoutProblem(): Promise<string | null> {
  ready ??= open().catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
  return ready;
}

/** The subject of a PNG or JPEG, cut out. Throws when the cutout can't run. */
export async function cutout(picture: Buffer): Promise<Cutout> {
  const problem = await cutoutProblem();
  if (problem || !win) throw new Error(`The subject cutout can't run: ${problem ?? "its window closed"}`);
  const { png, coverage } = (await win.webContents.executeJavaScript(`window.clipcatCutout.cut(${JSON.stringify(picture.toString("base64"))})`)) as {
    png: string;
    coverage: number;
  };
  return { png: Buffer.from(png, "base64"), coverage };
}

/** Closed with the app's window, so the app can quit; it opens again when next needed. */
export function closeCutout(): void {
  win?.destroy();
}
