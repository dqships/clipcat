// Vercel Routing Middleware: answers page requests that prefer Markdown
// (`Accept: text/markdown`) with the page's Markdown at the same URL. Every
// other request carries on to the static files.

import { negotiate } from "./negotiate.mjs";

export const config = {
  // Page paths only: anything with a file extension is a static file.
  matcher: ["/", "/((?!.*\\.).*)"],
};

export default function middleware(request) {
  const origin = process.env.SITE_URL || new URL(request.url).origin;
  // `x-middleware-next` is what `next()` from @vercel/functions returns: carry on as if untouched.
  return negotiate(request, origin) ?? new Response(null, { headers: { "x-middleware-next": "1" } });
}
