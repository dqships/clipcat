// Reads the help pages in this folder for the site (apps/site/scripts/docs.mjs)
// and the app's Help window. Each page is Markdown with a short front matter
// (title, description, order, updated) and links to the others as `page.md`, so the
// folder also reads correctly on GitHub.

import { Marked } from "marked";

/**
 * @typedef {{ slug: string, title: string, description: string, order: number, updated: string, h1: string, markdown: string }} Doc
 * slug is "" for README.md, the index page; markdown is the body without the front matter.
 */

/** A GitHub-style heading id: "If it doesn't work" → "if-it-doesnt-work". */
export function headingId(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** One page from its file name and text. Throws on missing front matter, so a broken page fails the build. */
export function parseDoc(file, text) {
  const match = /^---\n([\s\S]*?)\n---\n+/.exec(text.replace(/\r\n/g, "\n"));
  if (!match) throw new Error(`${file} has no front matter`);
  const meta = Object.fromEntries(
    match[1].split("\n").map((line) => {
      const at = line.indexOf(":");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
  );
  const markdown = text.replace(/\r\n/g, "\n").slice(match[0].length);
  const h1 = /^# (.+)$/m.exec(markdown)?.[1];
  for (const [key, value] of Object.entries({ title: meta.title, description: meta.description, order: meta.order, updated: meta.updated, h1 })) {
    if (!value) throw new Error(`${file} has no ${key}`);
  }
  const slug = file === "README.md" ? "" : file.replace(/\.md$/, "");
  return { slug, title: meta.title, description: meta.description, order: Number(meta.order), updated: meta.updated, h1, markdown };
}

/** Every page, in reading order, from `{ "getting-started.md": text, … }`. */
export function parseDocs(files) {
  return Object.entries(files)
    .filter(([name]) => name.endsWith(".md"))
    .map(([name, text]) => parseDoc(name, text))
    .sort((a, b) => a.order - b.order);
}

/** A link between pages, `page.md#part`, as its slug and anchor; null for any other link. */
export function docLink(href) {
  const match = /^(?:\.\/)?([a-z0-9-]+|README)\.md(#[\w-]+)?$/i.exec(href);
  if (!match) return null;
  return { slug: match[1] === "README" ? "" : match[1], hash: match[2] ?? "" };
}

/** The Markdown with links between pages rewritten by `to(slug, hash)`. */
export function rewriteLinks(markdown, to) {
  return markdown.replace(/\]\(([^)\s]+)\)/g, (whole, href) => {
    const link = docLink(href);
    return link ? `](${to(link.slug, link.hash)})` : whole;
  });
}

const escape = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * The page as HTML: headings get GitHub's ids so `page.md#part` links land,
 * links between pages go through `to(slug, hash)`, and links out of the docs
 * are marked external.
 */
export function renderDoc(markdown, to) {
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = headingId(tokens.map((t) => t.raw).join(""));
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const link = docLink(href);
        const target = link ? to(link.slug, link.hash) : href;
        const external = !link && /^https?:/.test(href);
        return `<a href="${escape(target)}"${title ? ` title="${escape(title)}"` : ""}${external ? ' rel="noopener" data-external=""' : ""}>${text}</a>`;
      },
    },
  });
  return marked.parse(markdown, { async: false });
}
