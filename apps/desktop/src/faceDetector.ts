// The face detector behind the vertical crop: Chromium's Shape Detection API
// (FaceDetector), which uses the system's own detector (Vision on macOS,
// Windows.Media.FaceAnalysis on Windows), so nothing is bundled or
// downloaded. It runs in a hidden window of its own with the experimental
// web platform features it is behind turned on; the app's own window never
// gets them.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BrowserWindow, app } from "electron";
import type { FaceBox, FaceDetector } from "./media/faces";

/** Runs in the hidden window: detects faces in each base64 JPEG, as fractions of its frame. */
const DETECT = `async (jpegs) => {
  const detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 4 });
  const out = [];
  for (const b64 of jpegs) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    const faces = await detector.detect(image);
    out.push(faces.map(({ boundingBox: b }) => ({ x: b.x / image.width, y: b.y / image.height, width: b.width / image.width, height: b.height / image.height })));
    image.close();
  }
  return out;
}`;

/** Asks for a detection on a blank frame, so a detector that exists but can't run counts as missing. */
const PROBE = `(async () => {
  if (typeof FaceDetector === "undefined") return "FaceDetector is not available";
  try {
    const canvas = new OffscreenCanvas(64, 64);
    canvas.getContext("2d").fillRect(0, 0, 64, 64);
    await new FaceDetector().detect(await createImageBitmap(canvas));
    return null;
  } catch (e) {
    return String(e && e.message || e);
  }
})()`;

let win: BrowserWindow | null = null;
let ready: Promise<string | null> | null = null;

async function open(): Promise<string | null> {
  const w = new BrowserWindow({
    show: false,
    width: 64,
    height: 64,
    webPreferences: { experimentalFeatures: true, backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win = w;
  w.on("closed", () => {
    win = null;
    ready = null;
  });
  const page = join(app.getPath("temp"), "clipcat-faces.html");
  await writeFile(page, "<!doctype html><meta charset=utf-8><title>faces</title>");
  await w.loadFile(page);
  const problem = (await w.webContents.executeJavaScript(PROBE)) as string | null;
  if (problem) {
    // Nothing to keep it open for; the answer stays the same until the app restarts.
    w.removeAllListeners("closed");
    w.destroy();
    win = null;
  }
  return problem;
}

/** Why there's no face detector on this system, or null when there is one. Opens the hidden window on first use. */
export function faceDetectorProblem(): Promise<string | null> {
  ready ??= open().catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
  return ready;
}

/** The detector, or null when this system has none. */
export async function faceDetector(): Promise<FaceDetector | null> {
  if (await faceDetectorProblem()) return null;
  return async (jpegs) => {
    if (!win) {
      const problem = await faceDetectorProblem();
      if (problem || !win) throw new Error(problem ?? "The face detector closed");
    }
    const list = JSON.stringify(jpegs.map((j) => j.toString("base64")));
    return (await win.webContents.executeJavaScript(`(${DETECT})(${list})`)) as FaceBox[][];
  };
}

/** Closed with the app's window, so the app can quit; it opens again when next needed. */
export function closeFaceDetector(): void {
  win?.destroy();
}
