// Serves the built UI from app://clipcat/ so the renderer runs on a real,
// secure origin instead of file://, a project's prepared media (proxies,
// thumbnails, waveforms) from media://<project id>/, and motion slides'
// pages from slide://, the sound effects from sound://sfx/, and the cutout
// model from model://cutout/. Those that serve files refuse any path outside
// their folder.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";

export const APP_SCHEME = "app";
export const APP_ORIGIN = "app://clipcat";
export const MEDIA_SCHEME = "media";
export const SLIDE_SCHEME = "slide";
export const SOUND_SCHEME = "sound";
export const MODEL_SCHEME = "model";

/** Must run before the app is ready. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    // CORS-enabled so the thumbnail editor can draw frames on a canvas and still save it.
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
    { scheme: SLIDE_SCHEME, privileges: { standard: true, secure: true } },
    { scheme: SOUND_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
    { scheme: MODEL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

/** The file a request path maps to inside `root`, or null if it would escape it. */
export function resolveInside(root: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  const wanted = resolve(root, `.${normalize(`/${decoded}`)}`);
  const rel = relative(root, wanted);
  if (rel.startsWith("..") || rel.includes(`..${sep}`) || resolve(root, rel) !== wanted) return null;
  return rel === "" ? resolve(root, "index.html") : wanted;
}

/** Pages that run cross-origin isolated, so their WebAssembly can use threads. */
const ISOLATED = new Set(["/cutout.html"]);

export function serveUi(uiRoot: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== "clipcat") return new Response("Not found", { status: 404 });
    const file = resolveInside(uiRoot, url.pathname);
    if (!file) return new Response("Not found", { status: 404 });
    // Worker scripts (.mjs) carry the policy too, or an isolated page can't start them.
    if (!ISOLATED.has(url.pathname) && extname(file) !== ".mjs") return net.fetch(pathToFileURL(file).toString());
    const page = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(page.headers);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    return new Response(page.body, { status: page.status, headers });
  });
}

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".onnx": "application/octet-stream",
};

/** Lets the app's pages (and the dev server) read these files, not only show them. */
const SHARED = { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" };

/** Parses a single `bytes=a-b` range against a file size; null when absent or unsatisfiable. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

/**
 * Serves media://<project id>/<path> from that project's media folder, with
 * byte ranges so the video element can seek. `projectDir` throws on a bad id.
 */
export function serveMedia(projectDir: (id: string) => string): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    let root: string;
    try {
      root = join(projectDir(new URL(request.url).host), "media");
    } catch {
      return new Response("Not found", { status: 404 });
    }
    return serveFile(request, root, SHARED);
  });
}

/** Serves model://cutout/<file> from the folder the cutout model ships in. */
export function serveModels(modelsDir: string): void {
  protocol.handle(MODEL_SCHEME, (request) =>
    new URL(request.url).host === "cutout" ? serveFile(request, modelsDir, SHARED) : new Response("Not found", { status: 404 }),
  );
}

/** Serves sound://sfx/<id>.wav from the folder the sound effects ship in. */
export function serveSounds(sfxDir: string): void {
  protocol.handle(SOUND_SCHEME, (request) =>
    new URL(request.url).host === "sfx" ? serveFile(request, sfxDir) : new Response("Not found", { status: 404 }),
  );
}

/** A file inside `root` named by the request's path, with byte ranges. */
async function serveFile(request: Request, root: string, extra: Record<string, string> = {}): Promise<Response> {
  const file = resolveInside(root, new URL(request.url).pathname);
  if (!file || !(extname(file) in TYPES)) return new Response("Not found", { status: 404 });
  let size: number;
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    size = info.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const type = TYPES[extname(file)]!;
  const rangeHeader = request.headers.get("range");
  const range = parseRange(rangeHeader, size);
  if (rangeHeader && !range) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      ...extra,
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}

const SAFE_ID = /^[a-z0-9-]+$/i;

/**
 * Serves slide://<project id>/<asset id> (and slide://draft/<token> for one
 * being designed) as a whole page from `page`, under the slide policy, so
 * the page can run its own inline script and load nothing else.
 */
export function serveSlides(page: (host: string, id: string) => Promise<string | null>, csp: string): void {
  protocol.handle(SLIDE_SCHEME, async (request) => {
    const url = new URL(request.url);
    const id = url.pathname.replace(/^\/+/, "");
    if (!SAFE_ID.test(url.host) || !SAFE_ID.test(id)) return new Response("Not found", { status: 404 });
    const html = await page(url.host, id).catch(() => null);
    if (html === null) return new Response("Not found", { status: 404 });
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": csp, "Cache-Control": "no-store" } });
  });
}
