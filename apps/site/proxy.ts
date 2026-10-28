// Answers `.md` addresses, and page requests that prefer Markdown
// (`Accept: text/markdown`), with the page's Markdown. Everything else carries
// on to the pages.

import { NextResponse, type NextRequest } from "next/server";
import { negotiate } from "./lib/negotiate.mjs";
import { siteOrigin } from "./lib/site.mjs";

export function proxy(request: NextRequest) {
  const markdown = negotiate(request, siteOrigin());
  if (markdown) return markdown;
  // The HTML differs by Accept too, so caches must key on it.
  const response = NextResponse.next();
  response.headers.append("Vary", "Accept");
  return response;
}

export const config = {
  // Page paths (no file extension) and `.md` addresses; never Next's own files.
  matcher: ["/", "/((?!_next/)(?!.*\\.).*)", "/((?!_next/).*\\.md)"],
};
