// The parts of the launch checklist that don't need a running site: page
// copy lengths, the Markdown for agents, content negotiation, the proxy's
// matcher, the response headers and the design tokens. test/server checks the
// built site itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NOT_FOUND, PAGES, llmsTxt, pageMarkdown, robotsTxt, sitemapXml } from "../lib/markdown.mjs";
import { negotiate, wantsMarkdown } from "../lib/negotiate.mjs";
import { SECURITY_HEADERS, siteOrigin } from "../lib/site.mjs";
import nextConfig from "../next.config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://clipcat.example";
const read = (file) => readFileSync(file, "utf8");

test("titles and descriptions fit search results", () => {
  for (const page of [...PAGES, NOT_FOUND]) {
    const min = page === NOT_FOUND ? 15 : 30;
    assert.ok(page.title.length >= min && page.title.length <= 60, `${page.path} title is ${page.title.length} characters`);
    assert.ok(page.description.length >= 120 && page.description.length <= 160, `${page.path} description is ${page.description.length} characters`);
  }
});

test("About, Contact, Privacy and Pricing pages exist", () => {
  for (const path of ["/about", "/contact", "/privacy", "/pricing"]) assert.ok(PAGES.some((p) => p.path === path));
});

test("every page's Markdown has its H1 and only absolute links", () => {
  for (const page of PAGES) {
    const md = pageMarkdown(page, ORIGIN);
    assert.ok(md.startsWith(`# ${page.h1}\n`));
    assert.doesNotMatch(md, /\]\(\//, "links are absolute");
    assert.doesNotMatch(md, /<[a-z]/i, "no HTML");
  }
});

test("robots.txt, sitemap.xml and llms.txt", () => {
  const robots = robotsTxt(ORIGIN);
  assert.match(robots, /^User-agent: \*\nAllow: \/\n/);
  assert.match(robots, new RegExp(`Sitemap: ${ORIGIN}/sitemap.xml`));
  const sitemap = sitemapXml(ORIGIN);
  assert.equal(sitemap.match(/<url>/g).length, PAGES.length);
  assert.equal(sitemap.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g).length, PAGES.length);
  const llms = llmsTxt(ORIGIN);
  assert.match(llms, /^# ClipCat\n\n> /);
  assert.equal([...llms.matchAll(/\]\(https:\/\/clipcat\.example\/[^)]*\.md\)/g)].length, PAGES.length);
});

test("Markdown is chosen only when it's named and not ranked below HTML", () => {
  assert.equal(wantsMarkdown("text/markdown"), true);
  assert.equal(wantsMarkdown("text/markdown, text/html;q=0.9"), true);
  assert.equal(wantsMarkdown("text/html, text/markdown"), true);
  assert.equal(wantsMarkdown("text/markdown;q=0.5, text/html"), false);
  assert.equal(wantsMarkdown("text/html,application/xhtml+xml,*/*;q=0.8"), false);
  assert.equal(wantsMarkdown("*/*"), false);
  assert.equal(wantsMarkdown("text/*"), false);
  assert.equal(wantsMarkdown("text/markdown;q=0"), false);
  assert.equal(wantsMarkdown(null), false);
});

test("negotiation answers pages and .md addresses with Markdown, and unknown ones with a 404", async () => {
  const ask = (path, accept = "text/markdown", method = "GET") => negotiate(new Request(`${ORIGIN}${path}`, { method, headers: { accept } }), ORIGIN);
  const about = ask("/about");
  assert.equal(about.status, 200);
  assert.equal(about.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(about.headers.get("vary"), "Accept");
  assert.equal(about.headers.get("x-content-type-options"), "nosniff");
  assert.match(await about.text(), /^# About ClipCat\n/);
  assert.equal(ask("/about/").status, 200);
  assert.equal(ask("/about.md", "text/html").status, 200);
  assert.match(await ask("/index.md", "*/*").text(), new RegExp(`^# ${PAGES[0].h1}`));
  const missing = ask("/no-such-page");
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /^# Page not found\n[\s\S]*\[About\]\(https:\/\/clipcat\.example\/about\.md\)/);
  assert.equal(ask("/no-such-page.md", "*/*").status, 404);
  assert.equal(await ask("/about", "text/markdown", "HEAD").text(), "");
  assert.equal(ask("/about", "text/html"), null);
  assert.equal(ask("/about", "text/markdown", "POST"), null);
});

test("the proxy runs on page paths and .md addresses only", () => {
  // Next.js needs the matcher written out in proxy.ts, so it's read from there. Each one is anchored at both ends.
  const matcher = JSON.parse(read(join(root, "proxy.ts")).match(/matcher: (\[.*\])/)[1]);
  const matches = (path) => matcher.some((m) => new RegExp(`^${m}$`).test(path));
  for (const path of ["/", "/about", "/no-such-page", "/about.md", "/index.md"]) assert.ok(matches(path), path);
  for (const path of ["/_next/static/chunks/main.js", "/favicon.svg", "/fonts/jost-latin-400-normal.woff2", "/robots.txt", "/llms.txt"]) {
    assert.ok(!matches(path), path);
  }
});

test("every response gets the security headers and Vary: Accept", async () => {
  const [all] = await nextConfig.headers();
  const headers = Object.fromEntries(all.headers.map((h) => [h.key, h.value]));
  assert.equal(all.source, "/:path*");
  assert.equal(headers["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
  assert.match(headers["Content-Security-Policy"], /default-src 'self'/);
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'self'/);
  assert.equal(headers["X-Frame-Options"], "SAMEORIGIN");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers.Vary, "Accept");
  assert.equal(SECURITY_HEADERS.length, 6);
});

test("the site's tokens are the design system's tokens", () => {
  assert.equal(read(join(root, "styles", "tokens.css")), read(join(root, "..", "..", "design", "tokens.css")));
});

test("the production address comes from SITE_URL, then Vercel, then the custom domain", () => {
  assert.equal(siteOrigin({ SITE_URL: "https://clipcat.app/" }), "https://clipcat.app");
  assert.equal(siteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "clipcat.vercel.app" }), "https://clipcat.vercel.app");
  assert.equal(siteOrigin({}), "https://clipcat.followusai.com");
});
