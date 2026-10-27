// Serves the built UI from app://clipcat/ so the renderer runs on a real,
// secure origin instead of file://, and a project's prepared media (proxies,
// thumbnails, waveforms) from media://<project id>/. Both refuse any path
// outside their folder.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";

export const APP_SCHEME = "app";
export const APP_ORIGIN = "app://clipcat";
export const MEDIA_SCHEME = "media";

/** Must run before the app is ready. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
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

export function serveUi(uiRoot: string): void {
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.host !== "clipcat") return new Response("Not found", { status: 404 });
    const file = resolveInside(uiRoot, url.pathname);
    if (!file) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".wav": "audio/wav",
};

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
    const url = new URL(request.url);
    let root: string;
    try {
      root = join(projectDir(url.host), "media");
    } catch {
      return new Response("Not found", { status: 404 });
    }
    const file = resolveInside(root, url.pathname);
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
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
      },
    });
  });
}
