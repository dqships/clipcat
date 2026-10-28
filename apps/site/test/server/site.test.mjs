// Checks the built site, served by `next start`, against the launch
// checklist: each page's head, one H1 and real content in the raw HTML, links
// that resolve, Markdown at every URL, real 404s, and the headers.
// Run with `npm run test:server`, which builds first with SITE_URL set to the
// origin below.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NOT_FOUND, PAGES } from "../../lib/markdown.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORIGIN = "https://clipcat.example";
let base;
let server;

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [createRequire(import.meta.url).resolve("next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: root,
    env: { ...process.env, SITE_URL: ORIGIN },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(base);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("next start didn't answer");
});
after(() => server?.kill());

const get = (path, headers = {}) => fetch(`${base}${path}`, { headers, redirect: "manual" });
const attr = (html, re) => html.match(re)?.[1];
const text = (html) =>
  html
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const decode = (s) => s.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

for (const page of [...PAGES, NOT_FOUND]) {
  const path = page === NOT_FOUND ? "/no-such-page" : page.path;

  test(`${page.path}: status, head and headers`, async () => {
    const res = await get(path);
    assert.equal(res.status, page === NOT_FOUND ? 404 : 200);
    assert.match(res.headers.get("content-type"), /^text\/html/);
    assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.match(res.headers.get("strict-transport-security"), /max-age=31536000; includeSubDomains/);
    assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
    const html = await res.text();
    assert.match(html, /^<!DOCTYPE html><html lang="en"/);
    assert.match(html, /<meta charSet="utf-8"/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1"/);
    assert.equal(decode(attr(html, /<title[^>]*>([^<]*)<\/title>/)), page.title);
    assert.equal(decode(attr(html, /<meta name="description" content="([^"]*)"/)), page.description);
    assert.match(html, /<meta name="is-agentic-site-type" content="app"/);
    assert.match(html, /<link rel="icon" href="\/favicon.ico"/);
    for (const key of ["og:title", "og:description", "og:image", "og:url", "og:type"]) assert.match(html, new RegExp(`property="${key}" content="[^"]+"`));
    for (const key of ["twitter:title", "twitter:description", "twitter:image"]) assert.match(html, new RegExp(`name="${key}" content="[^"]+"`));
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    assert.doesNotMatch(html, /noindex/);
    const ld = JSON.parse(attr(html, /<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/));
    const types = ld["@graph"].map((n) => n["@type"]);
    assert.ok(types.includes("Organization") && types.includes("SoftwareApplication"));
    if (page !== NOT_FOUND) {
      assert.equal(attr(html, /<link rel="canonical" href="([^"]+)"/), page.path === "/" ? `${ORIGIN}/` : `${ORIGIN}${page.path}`);
      assert.match(html, /<link rel="alternate" type="text\/markdown" href="[^"]+\.md"/);
    }
  });

  test(`${page.path}: content and structure`, async () => {
    const html = await (await get(path)).text();
    assert.equal(html.match(/<h1[\s>]/g)?.length, 1, "one H1");
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    levels.forEach((level, i) => i && assert.ok(level <= levels[i - 1] + 1, `heading h${level} follows h${levels[i - 1]}`));
    assert.equal(html.match(/<main[\s>]/g)?.length, 1);
    assert.ok(text(html).length >= 500, `${text(html).length} characters of text`);
    assert.ok(text(html).length / html.length >= 0.05, `content is ${Math.round((100 * text(html).length) / html.length)}% of the markup`);
    for (const img of html.match(/<img [^>]*>/g) ?? []) assert.match(img, / alt="[^"]+"/);
    assert.doesNotMatch(html, /tabindex="[1-9]/);
    assert.doesNotMatch(html, /<script(?! type="application\/ld\+json")/, "no JavaScript on the pages");
    for (const [, href] of html.matchAll(/<a [^>]*href="(\/[^"#]*)"/g)) {
      const res = await get(href);
      assert.equal(res.status, 200, `${href} resolves`);
    }
  });
}

test("Markdown at every page URL and every .md address", async () => {
  for (const page of PAGES) {
    const res = await get(page.path, { accept: "text/markdown" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/markdown; charset=utf-8");
    assert.match(res.headers.get("vary"), /Accept/);
    assert.ok((await res.text()).startsWith(`# ${page.h1}\n`));
    const file = await get(page.path === "/" ? "/index.md" : `${page.path}.md`);
    assert.equal(file.status, 200);
    assert.ok((await file.text()).startsWith(`# ${page.h1}\n`));
  }
  const missing = await get("/no-such-page", { accept: "text/markdown" });
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /^# Page not found\n/);
  assert.equal((await get("/no-such-page.md")).status, 404);
});

test("browsers still get HTML", async () => {
  const res = await get("/about", { accept: "text/html,application/xhtml+xml,*/*;q=0.8" });
  assert.match(res.headers.get("content-type"), /^text\/html/);
});

test("robots.txt, sitemap.xml and llms.txt", async () => {
  const robots = await get("/robots.txt");
  assert.match(robots.headers.get("content-type"), /^text\/plain/);
  assert.match(await robots.text(), new RegExp(`Sitemap: ${ORIGIN}/sitemap.xml`));
  const sitemap = await get("/sitemap.xml");
  assert.match(sitemap.headers.get("content-type"), /xml/);
  assert.equal((await sitemap.text()).match(/<url>/g).length, PAGES.length);
  const llms = await get("/llms.txt");
  assert.match(await llms.text(), /^# ClipCat\n\n> /);
});

test("old .html addresses redirect to the clean ones", async () => {
  const res = await get("/about.html");
  assert.equal(res.status, 308);
  assert.equal(new URL(res.headers.get("location"), base).pathname, "/about");
});
