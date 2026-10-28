// A local stand-in for Vercel, for checking the built site: serves dist/ with
// vercel.json's headers and clean URLs, runs the same Markdown negotiation as
// middleware.js, and answers unknown paths with 404.html and a 404 status.
//   node build.mjs && node serve.mjs [port]

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { negotiate } from "./negotiate.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** vercel.json's `source` patterns, as regular expressions. */
const rules = config.headers.map(({ source, headers }) => ({ re: new RegExp(`^${source}$`), headers }));

function file(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  for (const candidate of [clean === "/" ? "/index.html" : clean, `${clean}.html`]) {
    const path = join(dist, candidate);
    if (path.startsWith(dist) && existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

export function serve(port = 4322) {
  const server = createServer(async (req, res) => {
    const origin = `http://${req.headers.host}`;
    const { pathname } = new URL(req.url, origin);
    const headers = {};
    for (const rule of rules) if (rule.re.test(pathname)) for (const { key, value } of rule.headers) headers[key.toLowerCase()] = value;

    if (config.cleanUrls && pathname.endsWith(".html")) {
      res.writeHead(308, { ...headers, location: pathname.replace(/(\/index)?\.html$/, "") || "/" }).end();
      return;
    }
    if (pathname.length > 1 && pathname.endsWith("/")) {
      res.writeHead(308, { ...headers, location: pathname.replace(/\/+$/, "") }).end();
      return;
    }

    if (!extname(pathname)) {
      const request = new Request(new URL(req.url, origin), { method: req.method, headers: req.headers });
      const answer = negotiate(request, origin);
      if (answer) {
        res.writeHead(answer.status, { ...headers, ...Object.fromEntries(answer.headers) });
        res.end(req.method === "HEAD" ? undefined : await answer.text());
        return;
      }
    }

    const path = file(pathname);
    const status = path ? 200 : 404;
    const served = path ?? join(dist, "404.html");
    res.writeHead(status, { "content-type": TYPES[extname(served)] ?? "application/octet-stream", ...headers });
    res.end(req.method === "HEAD" ? undefined : readFileSync(served));
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 4322;
  await serve(port);
  console.log(`serving dist/ on http://127.0.0.1:${port}`);
}
