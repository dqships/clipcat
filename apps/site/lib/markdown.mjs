// What the pages share besides their HTML: the Markdown version of each page
// for agents, the structured data, robots.txt, sitemap.xml and llms.txt. Pure
// functions with no file or network access, so the pages, the route handlers
// and the proxy share them.

import { NOT_FOUND, PAGES, SITE } from "./content.mjs";
import { DOCS } from "./docs.generated.mjs";

/** Pages in the header; the footer lists them all. */
export const HEADER = ["/features", "/docs", "/download", "/pricing", "/about"];

/** Every page with an address: the site's own pages, then the help pages. */
export const ALL = [...PAGES, ...DOCS];
export const OG = { path: "/og.png", width: 1200, height: 630, alt: "ClipCat: raw takes in, finished video out." };

/** The same text for Markdown, with the site's own links made absolute. */
function inlineMd(text, origin) {
  return text.replace(/\]\((\/[^)\s]*)\)/g, (_, path) => `](${origin}${path})`);
}

export const url = (origin, path) => `${origin}${path === "/" ? "/" : path}`;
const mdPath = (path) => (path === "/" ? "/index.md" : `${path}.md`);

/** The page's schema.org graph, as JSON that is safe inside a script element. */
export function jsonLd(page, origin) {
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
    operatingSystem: "macOS 14 or newer (Apple Silicon or Intel), Windows 10 and 11 (64-bit)",
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

export function longDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[m - 1]} ${y}`;
}

export function pageMarkdown(page, origin) {
  const md = (t) => inlineMd(t, origin);
  // A help page is Markdown already.
  if (page.markdown !== undefined) {
    return [md(page.markdown).trimEnd(), "", `Last updated ${longDate(page.updated)}.`, "", `Web page: ${url(origin, page.path)}`, ""].join("\n");
  }
  const out = [`# ${page.h1}`, "", md(page.lede), ""];
  if (page.hero) out.push(downloadsMd(), "");
  for (const s of page.sections) {
    if (s.h2) out.push(`## ${s.h2}`, "");
    if (s.caption) out.push(md(s.caption), "");
    for (const p of s.body ?? []) out.push(md(p), "");
    if (s.note) out.push(md(s.note), "");
    if (s.steps) out.push(...s.steps.map((st, i) => `${i + 1}. **${st.title}**: ${md(st.text)}`), "");
    if (s.cards) out.push(...s.cards.map((c) => `- **${c.title}**: ${md(c.text)}`), "");
    if (s.prompts) out.push(...s.prompts.map((p) => `- "${p}"`), "");
    if (s.list) out.push(...s.list.map((i) => `- ${md(i)}`), "");
    if (s.h3) out.push(`### ${s.h3}`, "", md(s.detail), "");
    if (s.session) out.push("```", ...s.session, "```", "");
    if (s.download && !page.hero) out.push(downloadsMd(), "");
    if (s.pageList) out.push(...PAGES.map((p) => `- [${p.nav}](${origin}${mdPath(p.path)}): ${p.description}`), "");
    if (s.more) out.push(md(s.more), "");
  }
  if (page.updated) out.push(`Last updated ${longDate(page.updated)}.`, "");
  if (page.path !== NOT_FOUND.path) out.push(`Web page: ${url(origin, page.path)}`, "");
  return out.join("\n");
}

function downloadsMd() {
  return [
    `- [Download for Mac](${SITE.mac}) (Apple Silicon, macOS 14 or newer)`,
    `- [Download for Intel Macs](${SITE.macIntel}) (macOS 14 or newer)`,
    `- [Download for Windows](${SITE.windows}) (64-bit Windows 10 or 11)`,
    `- [All releases](${SITE.releases})`,
  ].join("\n");
}

/** llms.txt: what the site is and where each page's Markdown is. */
export function llmsTxt(origin) {
  return [
    `# ${SITE.name}`,
    "",
    `> ${SITE.tagline} ClipCat is a desktop app for Macs (Apple Silicon and Intel) and Windows. It transcribes on your computer, then uses your own Claude Code, Codex or Claude API key to suggest the first edit (cuts, zooms, b-roll, motion slides, sound and captions), shorts and a write-up.`,
    "",
    "Every page is also available as Markdown: request it with `Accept: text/markdown`, or use the `.md` links below.",
    "",
    "## Pages",
    "",
    ...PAGES.map((p) => `- [${p.nav}](${origin}${mdPath(p.path)}): ${p.description}`),
    "",
    "## Help",
    "",
    `How to use every part of the app. [All of it in one file](${origin}/llms-full.txt).`,
    "",
    ...DOCS.map((p) => `- [${p.h1}](${origin}${mdPath(p.path)}): ${p.description}`),
    "",
    "## Elsewhere",
    "",
    `- [Source code](${SITE.repo}): the app and this site`,
    `- [Releases](${SITE.releases}): installers and release notes`,
    `- [Issues](${SITE.issues}): bug reports and questions`,
    "",
  ].join("\n");
}

/** llms-full.txt: every help page in one file, for an agent that wants to read it all. */
export function llmsFullTxt(origin) {
  const pages = DOCS.map((p) => [inlineMd(p.markdown, origin).trimEnd(), "", `Web page: ${url(origin, p.path)}`].join("\n"));
  return [`# ${SITE.name} help, every page`, "", `> ${SITE.tagline}`, "", pages.join("\n\n---\n\n"), ""].join("\n");
}

export function robotsTxt(origin) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
}

export function sitemapXml(origin) {
  const urls = ALL.map((p) => `  <url><loc>${url(origin, p.path)}</loc><lastmod>${p.updated}</lastmod></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** The page for a request path, or null; `/about/` and `/about` are the same page. */
export function findPage(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return ALL.find((p) => p.path === path || (p.path === "/" && path === "/index")) ?? null;
}

export { DOCS, NOT_FOUND, PAGES, SITE, mdPath };
