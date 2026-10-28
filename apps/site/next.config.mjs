import { SECURITY_HEADERS } from "./lib/site.mjs";

/** @type {import("next").NextConfig} */
export default {
  poweredByHeader: false,
  trailingSlash: false,
  async headers() {
    return [
      // Pages answer with HTML or Markdown at the same URL (see proxy.ts), so caches key on Accept.
      { source: "/:path*", headers: [...SECURITY_HEADERS, { key: "Vary", value: "Accept" }] },
      { source: "/fonts/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/llms.txt", headers: [{ key: "Content-Type", value: "text/plain; charset=utf-8" }] },
    ];
  },
  async redirects() {
    // The first version of the site was plain HTML files.
    return [
      { source: "/index.html", destination: "/", permanent: true },
      { source: "/:page.html", destination: "/:page", permanent: true },
    ];
  },
};
