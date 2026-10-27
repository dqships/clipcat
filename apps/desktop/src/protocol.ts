// Serves the built UI from app://clipcat/ so the renderer runs on a real,
// secure origin instead of file://, and refuses any path outside the UI folder.

import { net, protocol } from "electron";
import { normalize, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const APP_SCHEME = "app";
export const APP_ORIGIN = "app://clipcat";

/** Must run before the app is ready. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
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
