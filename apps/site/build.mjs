// Builds the site into dist/: an HTML and a Markdown file per page, the 404
// page, robots.txt, sitemap.xml, llms.txt, one stylesheet, and the static
// files. Vercel serves dist/ as is; middleware.js adds Markdown negotiation.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NOT_FOUND, PAGES, llmsTxt, mdPath, pageHtml, pageMarkdown, robotsTxt, sitemapXml } from "./render.mjs";

const root = dirname(fileURLToPath(import.meta.url));

/** The production address: SITE_URL when set, otherwise the one Vercel gives the project. */
export function siteOrigin(env = process.env) {
  if (env.SITE_URL) return env.SITE_URL.replace(/\/$/, "");
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "https://clipcat.vercel.app";
}

export function build(out = join(root, "dist"), origin = siteOrigin()) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(root, "static"), out, { recursive: true });
  const write = (path, text) => writeFileSync(join(out, path), text);

  // One stylesheet: the design tokens, then the site's styles.
  write("styles.css", `${readFileSync(join(root, "static", "tokens.css"), "utf8")}\n${readFileSync(join(root, "styles", "site.css"), "utf8")}`);
  rmSync(join(out, "tokens.css"));

  for (const page of PAGES) {
    write(page.path === "/" ? "index.html" : `${page.path.slice(1)}.html`, pageHtml(page, origin));
    write(mdPath(page.path).slice(1), pageMarkdown(page, origin));
  }
  write("404.html", pageHtml(NOT_FOUND, origin));
  write("404.md", pageMarkdown(NOT_FOUND, origin));
  write("robots.txt", robotsTxt(origin));
  write("sitemap.xml", sitemapXml(origin));
  write("llms.txt", llmsTxt(origin));
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = build();
  console.log(`built ${PAGES.length} pages into ${out} for ${siteOrigin()}`);
}
