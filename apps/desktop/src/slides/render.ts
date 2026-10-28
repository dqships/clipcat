// Renders motion slides in a hidden offscreen window: stills for the AI
// editor to check its design, and the frames of the video the export lays
// over the picture, piped into ffmpeg as raw pixels. Each frame is a seek
// (see MOTION_RUNTIME), so a slow machine renders the same frames, only
// slower. Slides with no background keep their transparency in the video.

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { BrowserWindow, type NativeImage } from "electron";

export type SlideSize = { width: number; height: number };

/**
 * The window is a quarter of the frame at four times the pixel density: a
 * whole 1080p or vertical frame doesn't fit every screen, which would clamp
 * the window, but this always does, and the page still lays out on the
 * frame's full size in CSS pixels.
 */
const SCALE = 4;
/** Long enough for a page that loads nothing to be ready. */
const READY_MS = 15_000;

type Page = { win: BrowserWindow; duration: number; errors: () => Promise<string[]> };

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(what)), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

async function open(url: string, size: SlideSize): Promise<Page> {
  const win = new BrowserWindow({
    show: false,
    width: Math.ceil(size.width / SCALE),
    height: Math.ceil(size.height / SCALE),
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      offscreen: { deviceScaleFactor: SCALE },
      zoomFactor: 1 / SCALE,
      backgroundThrottling: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  try {
    await withTimeout(win.loadURL(url), READY_MS, "The slide didn't load");
    await withTimeout(win.webContents.executeJavaScript("window.motion.ready.then(() => true)"), READY_MS, "The slide never got ready");
    const duration = Number(await win.webContents.executeJavaScript("window.motion.duration")) || 0;
    return { win, duration, errors: async () => (await win.webContents.executeJavaScript("window.motion.errors.slice()")) as string[] };
  } catch (e) {
    win.destroy();
    throw e;
  }
}

async function capture(page: Page, t: number, size: SlideSize): Promise<NativeImage> {
  await page.win.webContents.executeJavaScript(`window.motion.seek(${t.toFixed(4)})`);
  const image = await page.win.webContents.capturePage();
  const got = image.getSize();
  return got.width === size.width && got.height === size.height ? image : image.resize({ width: size.width, height: size.height, quality: "best" });
}

/** Chromium's pixels have their color multiplied by alpha; ffmpeg's overlay wants it straight. Changed in place. */
export function unpremultiply(bgra: Buffer): Buffer {
  for (let i = 3; i < bgra.length; i += 4) {
    const a = bgra[i]!;
    if (a === 0 || a === 255) continue;
    bgra[i - 3] = Math.min(255, Math.round((bgra[i - 3]! * 255) / a));
    bgra[i - 2] = Math.min(255, Math.round((bgra[i - 2]! * 255) / a));
    bgra[i - 1] = Math.min(255, Math.round((bgra[i - 1]! * 255) / a));
  }
  return bgra;
}

export type Stills = { duration: number; errors: string[] };

/**
 * Writes the slide at `times` (seconds) as JPEGs, `width` wide, over a mid
 * tone when it has no background, so its text shows. Resolves with how long
 * its animations run and the errors the page reported.
 */
export async function renderStills(url: string, size: SlideSize, times: number[], files: string[], width = 1280, backdrop?: string): Promise<Stills> {
  const page = await open(url, size);
  try {
    if (backdrop) await page.win.webContents.executeJavaScript(`document.documentElement.style.background = ${JSON.stringify(backdrop)}`);
    for (const [i, t] of times.entries()) {
      const image = await capture(page, t, size);
      await writeFile(files[i]!, image.resize({ width, quality: "best" }).toJPEG(85));
    }
    return { duration: page.duration, errors: await page.errors() };
  } finally {
    page.win.destroy();
  }
}

/** Renders `duration` seconds at `fps` into a PNG-in-MOV video with alpha at `out`. */
export async function renderVideo(
  ffmpeg: string,
  url: string,
  size: SlideSize,
  fps: number,
  duration: number,
  out: string,
  opts: { signal: AbortSignal; progress?: (fraction: number) => void },
): Promise<void> {
  const frames = Math.max(1, Math.round(duration * fps));
  const page = await open(url, size);
  const args = [
    "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
    "-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${size.width}x${size.height}`, "-r", String(fps), "-i", "pipe:0",
    "-c:v", "png", "-pix_fmt", "rgba", "-f", "mov", out,
  ];
  const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
  let tail = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    tail = (tail + chunk).slice(-2000);
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  const abort = () => child.kill();
  opts.signal.addEventListener("abort", abort, { once: true });
  try {
    for (let n = 0; n < frames; n++) {
      if (opts.signal.aborted) throw new Error("cancelled");
      const pixels = unpremultiply((await capture(page, n / fps, size)).toBitmap());
      if (!child.stdin.write(pixels)) await new Promise<void>((resolve) => child.stdin.once("drain", () => resolve()));
      opts.progress?.((n + 1) / frames);
    }
    child.stdin.end();
    const code = await closed;
    if (opts.signal.aborted) throw new Error("cancelled");
    if (code !== 0) throw new Error(`ffmpeg couldn't write the slide: ${tail.trim().split("\n").slice(-2).join(" | ")}`);
  } catch (e) {
    child.kill();
    throw e;
  } finally {
    opts.signal.removeEventListener("abort", abort);
    page.win.destroy();
  }
}
