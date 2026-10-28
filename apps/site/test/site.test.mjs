// Checks the built site against the launch checklist: every page's head,
// one H1 and real content in the raw HTML, links that resolve, Markdown at
// every URL, real 404s, and the root files and headers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, siteOrigin } from "../build.mjs";
import { NOT_FOUND, PAGES } from "../content.mjs";
import { negotiate, wantsMarkdown } from "../negotiate.mjs";
import { config as middlewareConfig } from "../middleware.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://clipcat.example";
const out = mkdtempSync(join(tmpdir(), "clipcat-site-"));
build(out, ORIGIN);
process.on("exit", () => rmSync(out, { recursive: true, force: true }));

const htmlFile = (path) => join(out, path === "/" ? "index.html" : `${path.slice(1)}.html`);
const read = (file) => readFileSync(file, "utf8");
const attr = (html, re) => html.match(re)?.[1];
const text = (html) =>
  html
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

for (const page of [...PAGES, NOT_FOUND]) {
  test(`${page.path}: head`, () => {
    const html = read(page === NOT_FOUND ? join(out, "404.html") : htmlFile(page.path));
    assert.match(html, /^<!doctype html>\n<html lang="en">/);
    assert.match(html, /<meta charset="utf-8">/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    const title = attr(html, /<title>([^<]*)<\/title>/);
    assert.ok(title.length >= 15 && title.length <= 60, `title is ${title.length} characters`);
    const description = attr(html, /<meta name="description" content="([^"]*)">/).replace(/&#39;/g, "'");
    assert.ok(description.length >= 120 && description.length <= 160, `description is ${description.length} characters`);
    assert.match(html, /<meta name="is-agentic-site-type" content="app">/);
    assert.match(html, /<link rel="icon" href="\/favicon.ico"/);
    for (const key of ["og:title", "og:description", "og:image", "og:url", "og:type"]) assert.match(html, new RegExp(`property="${key}" content="[^"]+"`));
    for (const key of ["twitter:title", "twitter:description", "twitter:image"]) assert.match(html, new RegExp(`name="${key}" content="[^"]+"`));
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    assert.doesNotMatch(html, /noindex/);
    const ld = JSON.parse(attr(html, /<script type="application\/ld\+json">(.*?)<\/script>/));
    const types = ld["@graph"].map((n) => n["@type"]);
    assert.ok(types.includes("Organization") && types.includes("SoftwareApplication"));
    assert.ok(ld["@graph"][0].contactPoint && ld["@graph"][0].sameAs.length);
    if (page !== NOT_FOUND) {
      assert.ok(title.length >= 30, `title is ${title.length} characters`);
      assert.equal(attr(html, /<link rel="canonical" href="([^"]+)">/), page.path === "/" ? `${ORIGIN}/` : `${ORIGIN}${page.path}`);
    }
  });

  test(`${page.path}: content and structure`, () => {
    const html = read(page === NOT_FOUND ? join(out, "404.html") : htmlFile(page.path));
    assert.equal(html.match(/<h1[\s>]/g)?.length, 1, "one H1");
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    levels.forEach((level, i) => i && assert.ok(level <= levels[i - 1] + 1, `heading h${level} follows h${levels[i - 1]}`));
    assert.equal(html.match(/<main[\s>]/g)?.length, 1);
    assert.ok(text(html).length >= 500, `${text(html).length} characters of text`);
    assert.ok(text(html).length / html.length >= 0.05, "content is at least 5% of the markup");
    for (const img of html.match(/<img [^>]*>/g) ?? []) assert.match(img, / alt="[^"]+"/);
    assert.doesNotMatch(html, /tabindex="[1-9]/);
    assert.doesNotMatch(html, / style="/, "inline styles would break the CSP");
    assert.doesNotMatch(html, /<script(?! type="application\/ld\+json")/, "no scripts");
    for (const [, href] of html.matchAll(/href="(\/[^"#]*)"/g)) {
      const path = href.replace(/\/$/, "") || "/";
      assert.ok(existsSync(join(out, path)) || existsSync(htmlFile(path)), `${href} resolves`);
    }
  });
}

test("every page has Markdown beside it, with absolute links", () => {
  for (const page of PAGES) {
    const md = read(join(out, page.path === "/" ? "index.md" : `${page.path.slice(1)}.md`));
    assert.ok(md.startsWith(`# ${page.h1}\n`));
    assert.doesNotMatch(md, /\]\(\//, "links are absolute");
    assert.doesNotMatch(md, /<[a-z]/i, "no HTML");
  }
});

test("robots.txt, sitemap.xml and llms.txt", () => {
  const robots = read(join(out, "robots.txt"));
  assert.match(robots, /^User-agent: \*\nAllow: \/\n/);
  assert.match(robots, new RegExp(`Sitemap: ${ORIGIN}/sitemap.xml`));
  assert.doesNotMatch(robots, /Disallow/);
  const sitemap = read(join(out, "sitemap.xml"));
  assert.equal(sitemap.match(/<url>/g).length, PAGES.length);
  assert.equal(sitemap.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g).length, PAGES.length);
  const llms = read(join(out, "llms.txt"));
  assert.match(llms, /^# ClipCat\n\n> /);
  const own = [...llms.matchAll(/\]\((https:\/\/clipcat\.example[^)]*)\)/g)].map((m) => m[1].slice(ORIGIN.length));
  assert.equal(own.length, PAGES.length);
  for (const path of own) assert.ok(existsSync(join(out, path)), `${path} exists`);
});

test("About, Contact, Privacy and Pricing pages exist", () => {
  for (const path of ["/about", "/contact", "/privacy", "/pricing"]) assert.ok(PAGES.some((p) => p.path === path));
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

test("negotiation answers known pages with Markdown and unknown ones with a 404", async () => {
  const ask = (path, accept = "text/markdown", method = "GET") => negotiate(new Request(`${ORIGIN}${path}`, { method, headers: { accept } }), ORIGIN);
  const about = ask("/about");
  assert.equal(about.status, 200);
  assert.equal(about.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(about.headers.get("vary"), "Accept");
  assert.match(await about.text(), /^# About ClipCat\n/);
  assert.match(await ask("/").text(), /^# Edit your talking-head videos/);
  assert.equal(ask("/about/").status, 200);
  const missing = ask("/no-such-page");
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /^# Page not found\n[\s\S]*\[About\]\(https:\/\/clipcat\.example\/about\.md\)/);
  assert.equal(await ask("/about", "text/markdown", "HEAD").text(), "");
  assert.equal(ask("/about", "text/html"), null);
  assert.equal(ask("/about", "text/markdown", "POST"), null);
});

test("the middleware runs on page paths only", () => {
  const matches = (path) => middlewareConfig.matcher.some((m) => new RegExp(`^${m.replace("/((?!", "/((?!")}$`).test(path));
  for (const path of ["/", "/about", "/no-such-page"]) assert.ok(matches(path), path);
  for (const path of ["/about.md", "/styles.css", "/fonts/jost-latin-400-normal.woff2", "/robots.txt"]) assert.ok(!matches(path), path);
});

test("vercel.json sends the security headers and Vary: Accept", () => {
  const config = JSON.parse(read(join(root, "vercel.json")));
  const all = Object.fromEntries(config.headers.find((h) => h.source === "/(.*)").headers.map((h) => [h.key, h.value]));
  assert.equal(all["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
  assert.match(all["Content-Security-Policy"], /default-src 'self'/);
  assert.match(all["Content-Security-Policy"], /frame-ancestors 'self'/);
  assert.equal(all["X-Frame-Options"], "SAMEORIGIN");
  assert.equal(all["X-Content-Type-Options"], "nosniff");
  assert.equal(all.Vary, "Accept");
  assert.equal(config.outputDirectory, "dist");
  assert.equal(config.cleanUrls, true);
});

test("the site's tokens are the design system's tokens", () => {
  assert.equal(read(join(root, "static", "tokens.css")), read(join(root, "..", "..", "design", "tokens.css")));
});

test("the production address comes from SITE_URL or Vercel", () => {
  assert.equal(siteOrigin({ SITE_URL: "https://clipcat.app/" }), "https://clipcat.app");
  assert.equal(siteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "clipcat.vercel.app" }), "https://clipcat.vercel.app");
});
