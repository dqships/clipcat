// The face detector behind the vertical crop: the UI's faces.html page
// (MediaPipe's BlazeFace model on its WebAssembly runtime, both shipped with
// the app) in a hidden window of its own, so detection runs offline and the
// same on macOS and Windows. Chromium's own FaceDetector would be lighter, but
// it isn't implemented on Windows.

import { BrowserWindow } from "electron";
import type { FaceBox, FaceDetector } from "./media/faces";

/** Asks for a detection on a blank frame, so a page that loads but can't run counts as missing. */
const PROBE = `(async () => {
  try {
    await window.clipcatFaces.ready;
    const canvas = new OffscreenCanvas(64, 64);
    canvas.getContext("2d").fillRect(0, 0, 64, 64);
    const blob = await canvas.convertToBlob({ type: "image/jpeg" });
    const b64 = btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
    await window.clipcatFaces.detect([b64]);
    return null;
  } catch (e) {
    return String((e && e.message) || e);
  }
})()`;

let page: string | null = null;
let win: BrowserWindow | null = null;
let ready: Promise<string | null> | null = null;

/** Where faces.html is served: the app's own origin, or the dev server. Set once at startup. */
export function setFacePage(url: string): void {
  page = url;
}

async function open(): Promise<string | null> {
  if (!page) return "The face detector's page isn't set";
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
    // Nothing to keep it open for; the answer stays the same until the app restarts.
    w.removeAllListeners("closed");
    w.destroy();
    win = null;
  }
  return problem;
}

/** Why there's no face detector, or null when there is one. Opens the hidden window on first use. */
export function faceDetectorProblem(): Promise<string | null> {
  ready ??= open().catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
  return ready;
}

/** The detector, or null when it can't run. */
export async function faceDetector(): Promise<FaceDetector | null> {
  if (await faceDetectorProblem()) return null;
  return async (jpegs) => {
    if (!win) {
      const problem = await faceDetectorProblem();
      if (problem || !win) throw new Error(problem ?? "The face detector closed");
    }
    const list = JSON.stringify(jpegs.map((j) => j.toString("base64")));
    return (await win.webContents.executeJavaScript(`window.clipcatFaces.detect(${list})`)) as FaceBox[][];
  };
}

/** Closed with the app's window, so the app can quit; it opens again when next needed. */
export function closeFaceDetector(): void {
  win?.destroy();
}
