// Markdown for agents: the same URL answers with Markdown when the request
// prefers it, and every page also has a `.md` address. Used by proxy.ts.

import { NOT_FOUND, findPage, pageMarkdown } from "./markdown.mjs";
import { SECURITY_HEADERS } from "./site.mjs";

/** The q value an Accept header gives a media type, through `type/*` and `*\/*` when not named. */
function quality(accept, type) {
  let best = { specificity: -1, q: 0 };
  for (const part of accept.split(",")) {
    const [range, ...params] = part.trim().toLowerCase().split(";");
    const q = Number(params.map((p) => p.trim()).find((p) => p.startsWith("q="))?.slice(2) ?? 1);
    const [main, sub] = (range ?? "").split("/");
    const specificity = range === type ? 2 : sub === "*" && main === type.split("/")[0] ? 1 : range === "*/*" ? 0 : -1;
    if (specificity > best.specificity) best = { specificity, q: Number.isFinite(q) ? q : 0 };
  }
  return best;
}

/** True when the request names Markdown and doesn't rank HTML above it. A bare `*\/*` gets HTML. */
export function wantsMarkdown(accept) {
  if (!accept) return false;
  const md = quality(accept, "text/markdown");
  if (md.specificity < 2 || md.q <= 0) return false;
  return md.q >= quality(accept, "text/html").q;
}

const HEADERS = {
  ...Object.fromEntries(SECURITY_HEADERS.map(({ key, value }) => [key.toLowerCase(), value])),
  "content-type": "text/markdown; charset=utf-8",
  vary: "Accept",
  "cache-control": "public, max-age=0, must-revalidate",
};

/**
 * The Markdown answer for a request, or null to serve the HTML as usual: for a
 * `.md` address, or a page request that prefers Markdown. An unknown page gets
 * a real 404 with a Markdown body.
 */
export function negotiate(request, origin) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const { pathname } = new URL(request.url);
  const file = pathname.endsWith(".md");
  if (!file && !wantsMarkdown(request.headers.get("accept"))) return null;
  const page = findPage(file ? pathname.slice(0, -3) : pathname);
  const body = pageMarkdown(page ?? NOT_FOUND, origin);
  return new Response(request.method === "HEAD" ? null : body, { status: page ? 200 : 404, headers: HEADERS });
}
