// Turns the page data in content.mjs into HTML for people and Markdown for
// agents. Pure functions with no file or network access, so the build and the
// routing middleware share them.

import { NOT_FOUND, PAGES, SITE } from "./content.mjs";

/** Pages in the header; the footer lists them all. */
const HEADER = ["/features", "/download", "/pricing", "/about"];
/** The lockup's own aspect ratio (its viewBox), so the image reserves the right space. */
const LOGO = { width: 112, height: 32 };
const OG = { path: "/og.png", width: 1200, height: 630, alt: "ClipCat: edit talking-head videos by editing the transcript." };

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** `[text](url)` and `**bold**` to HTML, with everything else escaped. */
export function inline(text) {
  return escape(text)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const external = /^https?:/.test(href);
      return `<a href="${href}"${external ? ' rel="noopener"' : ""}>${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/** The same text for Markdown, with the site's own links made absolute. */
function inlineMd(text, origin) {
  return text.replace(/\]\((\/[^)\s]*)\)/g, (_, path) => `](${origin}${path})`);
}

const url = (origin, path) => `${origin}${path === "/" ? "/" : path}`;
const mdPath = (path) => (path === "/" ? "/index.md" : `${path}.md`);

function jsonLd(page, origin) {
  const org = {
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: SITE.name,
    url: `${origin}/`,
    logo: `${origin}/apple-touch-icon.png`,
    sameAs: [SITE.repo],
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", url: SITE.issues, availableLanguage: "en" },
  };
  const app = {
    "@type": "SoftwareApplication",
    "@id": `${origin}/#app`,
    name: SITE.name,
    description: SITE.tagline,
    applicationCategory: "MultimediaApplication",
    applicationSubCategory: "Video editor",
    operatingSystem: "macOS 14 or newer (Apple Silicon), Windows 10 and 11 (64-bit)",
    downloadUrl: `${origin}/download`,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@id": `${origin}/#organization` },
    sameAs: [SITE.repo],
  };
  const webPage = {
    "@type": page.path === "/about" ? "AboutPage" : page.path === "/contact" ? "ContactPage" : "WebPage",
    "@id": `${url(origin, page.path)}#page`,
    url: url(origin, page.path),
    name: page.title,
    description: page.description,
    inLanguage: "en",
    isPartOf: { "@type": "WebSite", name: SITE.name, url: `${origin}/` },
    about: { "@id": `${origin}/#app` },
    ...(page.updated ? { dateModified: page.updated } : {}),
  };
  // `<` is escaped so the data can never close its own script element.
  return JSON.stringify({ "@context": "https://schema.org", "@graph": [org, app, webPage] }).replace(/</g, "\\u003c");
}

function head(page, origin) {
  const canonical = url(origin, page.path);
  const image = `${origin}${OG.path}`;
  const meta = (attr, key, value) => `<meta ${attr}="${key}" content="${escape(value)}">`;
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escape(page.title)}</title>`,
    meta("name", "description", page.description),
    ...(page.path === NOT_FOUND.path ? [] : [`<link rel="canonical" href="${canonical}">`, `<link rel="alternate" type="text/markdown" href="${mdPath(page.path)}">`]),
    meta("name", "is-agentic-site-type", "app"),
    '<meta name="color-scheme" content="light dark">',
    '<link rel="icon" href="/favicon.ico" sizes="32x32">',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="preload" href="/fonts/jost-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>',
    '<link rel="preload" href="/fonts/jost-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>',
    '<link rel="stylesheet" href="/styles.css">',
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", SITE.name),
    meta("property", "og:title", page.title),
    meta("property", "og:description", page.description),
    meta("property", "og:url", canonical),
    meta("property", "og:image", image),
    meta("property", "og:image:width", String(OG.width)),
    meta("property", "og:image:height", String(OG.height)),
    meta("property", "og:image:alt", OG.alt),
    meta("property", "og:locale", "en_US"),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", page.title),
    meta("name", "twitter:description", page.description),
    meta("name", "twitter:image", image),
    meta("name", "twitter:image:alt", OG.alt),
    `<script type="application/ld+json">${jsonLd(page, origin)}</script>`,
  ].join("\n");
}

function logo() {
  return `<picture><source srcset="/brand/clipcat-lockup-white.svg" media="(prefers-color-scheme: dark)"><img src="/brand/clipcat-lockup-ink.svg" alt="ClipCat home" width="${LOGO.width}" height="${LOGO.height}"></picture>`;
}

function masthead(current) {
  const links = HEADER.map((path) => {
    const page = PAGES.find((p) => p.path === path);
    return `<li><a href="${path}"${path === current ? ' aria-current="page"' : ""}>${escape(page.nav)}</a></li>`;
  }).join("");
  return `<header class="masthead"><div class="wrap masthead__inner"><a class="masthead__logo" href="/">${logo()}</a><nav class="masthead__nav" aria-label="Main"><ul>${links}</ul></nav></div></header>`;
}

function footer() {
  const links = PAGES.map((p) => `<li><a href="${p.path}">${escape(p.nav)}</a></li>`).join("");
  return `<footer class="footer"><div class="wrap footer__inner"><nav aria-label="Site"><ul class="footer__links">${links}<li><a href="${SITE.repo}" rel="noopener">Source on GitHub</a></li></ul></nav><p class="footer__note">ClipCat is a free, personal project. Fonts: Jost, under the SIL Open Font License.</p></div></footer>`;
}

function downloads() {
  return `<div class="downloads"><a class="button button--accent" href="${SITE.mac}">Download for Mac</a><a class="button button--secondary" href="${SITE.windows}">Download for Windows</a></div><p class="downloads__note">Apple Silicon, macOS 14 or newer. 64-bit Windows 10 or 11. <a href="${SITE.releases}" rel="noopener">All releases</a>.</p>`;
}

/** A still of the editor's idea: the transcript, with cut words struck out on tape. */
function heroFigure() {
  // Words marked ~ are cut; a run of them sits on one strip of tape.
  const words = (line) =>
    line
      .split(" ")
      .map((w) => (w.startsWith("~") ? `<del>${escape(w.slice(1))}</del>` : escape(w)))
      .join(" ")
      .replace(/<\/del> <del>/g, " ");
  return `<figure class="hero__figure"><div class="transcript" role="img" aria-label="A transcript in ClipCat with a retake and a pause struck out, and a suggestion to cut the retake.">
<p class="transcript__time">00:42</p>
<p class="transcript__line">${words("So the first thing ~you ~want, ~um, ~the ~first ~thing you want is a clear hook.")}</p>
<p class="transcript__time">00:47</p>
<p class="transcript__line">${words("Say what the video is about ~[pause ~2.1s] in one sentence.")}</p>
<p class="transcript__chip"><span class="chip">Retake</span> Cut “you want, um, the first thing”: the line starts again.</p>
</div><figcaption>Cuts are proposed with a reason, and nothing is cut until you accept it.</figcaption></figure>`;
}

function section(s) {
  const parts = [];
  if (s.h2) parts.push(`<h2>${escape(s.h2)}</h2>`);
  for (const p of s.body ?? []) parts.push(`<p>${inline(p)}</p>`);
  if (s.list) parts.push(`<ul class="list">${s.list.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`);
  if (s.steps) {
    parts.push(
      `<ol class="steps">${s.steps.map((st) => `<li class="steps__item"><h3>${escape(st.title)}</h3><p>${inline(st.text)}</p></li>`).join("")}</ol>`,
    );
  }
  if (s.cards) parts.push(`<ul class="cards">${s.cards.map((c) => `<li class="card"><h3>${escape(c.title)}</h3><p>${inline(c.text)}</p></li>`).join("")}</ul>`);
  if (s.download) parts.push(downloads());
  if (s.pageList) parts.push(`<ul class="list">${PAGES.map((p) => `<li><a href="${p.path}">${escape(p.nav)}</a>: ${escape(p.description)}</li>`).join("")}</ul>`);
  if (s.more) parts.push(`<p class="more">${inline(s.more)}</p>`);
  return `<section class="section">${parts.join("")}</section>`;
}

export function pageHtml(page, origin) {
  const intro = page.hero
    ? `<div class="hero"><div class="hero__text"><h1>${escape(page.h1)}</h1><p class="lede">${inline(page.lede)}</p>${downloads()}</div>${heroFigure()}</div>`
    : `<div class="intro"><h1>${escape(page.h1)}</h1><p class="lede">${inline(page.lede)}</p></div>`;
  const updated = page.updated ? `<p class="updated">Last updated <time datetime="${page.updated}">${longDate(page.updated)}</time>.</p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
${head(page, origin)}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${masthead(page.path)}
<main id="main" class="wrap">
${intro}
${page.sections.map(section).join("\n")}
${updated}
</main>
${footer()}
</body>
</html>
`;
}

function longDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[m - 1]} ${y}`;
}

export function pageMarkdown(page, origin) {
  const md = (t) => inlineMd(t, origin);
  const out = [`# ${page.h1}`, "", md(page.lede), ""];
  if (page.hero) out.push(downloadsMd(), "");
  for (const s of page.sections) {
    if (s.h2) out.push(`## ${s.h2}`, "");
    for (const p of s.body ?? []) out.push(md(p), "");
    if (s.steps) out.push(...s.steps.map((st, i) => `${i + 1}. **${st.title}**: ${md(st.text)}`), "");
    if (s.cards) out.push(...s.cards.map((c) => `- **${c.title}**: ${md(c.text)}`), "");
    if (s.list) out.push(...s.list.map((i) => `- ${md(i)}`), "");
    if (s.download && !page.hero) out.push(downloadsMd(), "");
    if (s.pageList) out.push(...PAGES.map((p) => `- [${p.nav}](${origin}${mdPath(p.path)}): ${p.description}`), "");
    if (s.more) out.push(md(s.more), "");
  }
  if (page.updated) out.push(`Last updated ${longDate(page.updated)}.`, "");
  if (page.path !== NOT_FOUND.path) out.push(`Web page: ${url(origin, page.path)}`, "");
  return out.join("\n");
}

function downloadsMd() {
  return [`- [Download for Mac](${SITE.mac}) (Apple Silicon, macOS 14 or newer)`, `- [Download for Windows](${SITE.windows}) (64-bit Windows 10 or 11)`, `- [All releases](${SITE.releases})`].join("\n");
}

/** llms.txt: what the site is and where each page's Markdown is. */
export function llmsTxt(origin) {
  return [
    `# ${SITE.name}`,
    "",
    `> ${SITE.tagline} ClipCat is a free desktop video editor for Apple Silicon Macs and Windows. It transcribes on your computer and uses your own Claude Code, Codex or Claude API key to suggest cuts.`,
    "",
    "Every page is also available as Markdown: request it with `Accept: text/markdown`, or use the `.md` links below.",
    "",
    "## Pages",
    "",
    ...PAGES.map((p) => `- [${p.nav}](${origin}${mdPath(p.path)}): ${p.description}`),
    "",
    "## Elsewhere",
    "",
    `- [Source code](${SITE.repo}): the app and this site`,
    `- [Releases](${SITE.releases}): installers and release notes`,
    `- [Issues](${SITE.issues}): bug reports and questions`,
    "",
  ].join("\n");
}

export function robotsTxt(origin) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
}

export function sitemapXml(origin) {
  const urls = PAGES.map((p) => `  <url><loc>${url(origin, p.path)}</loc><lastmod>${p.updated}</lastmod></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** The page for a request path, or null; `/about/` and `/about` are the same page. */
export function findPage(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PAGES.find((p) => p.path === path || (p.path === "/" && path === "/index")) ?? null;
}

export { NOT_FOUND, PAGES, SITE, mdPath };
