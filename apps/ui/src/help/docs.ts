// The help pages, read from the repo's docs/ folder when the UI is built: the
// same pages the site shows at /docs, so the two never disagree.

import { type Doc, parseDocs, renderDoc } from "../../../../docs/pages.mjs";

const files = import.meta.glob<string>("../../../../docs/*.md", { query: "?raw", import: "default", eager: true });

/** Every page, in reading order; the first is the overview. */
export const DOCS: Doc[] = parseDocs(Object.fromEntries(Object.entries(files).map(([path, text]) => [path.slice(path.lastIndexOf("/") + 1), text])));

/** A link to a page inside the Help window. */
export const pageHref = (slug: string, hash = "") => `?page=${slug}${hash}`;

/** A page as HTML, without its H1 (the window shows that itself). */
export const pageHtml = (doc: Doc) => renderDoc(doc.markdown.replace(/^# .+\n+/, ""), pageHref);

/** The page's words, without Markdown's marks, for search. */
const plain = (markdown: string) =>
  markdown
    .replace(/^\s*(?:#+|>|[-*]|\d+\.)\s+/gm, "")
    .replace(/^\|?\s*-{3}.*$/gm, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const TEXT = new Map(DOCS.map((d) => [d.slug, plain(d.markdown)]));

export type Hit = { doc: Doc; excerpt: string };

/** The pages that have every word of the query, title matches first, each with the words around its first match. */
export function searchDocs(query: string): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = DOCS.flatMap((doc) => {
    const text = TEXT.get(doc.slug)!;
    const lower = text.toLowerCase();
    if (!words.every((w) => lower.includes(w))) return [];
    const at = lower.indexOf(words[0]!);
    const start = Math.max(0, text.lastIndexOf(" ", Math.max(0, at - 40)) + 1);
    const end = text.indexOf(" ", Math.min(text.length, at + 80));
    const excerpt = `${start > 0 ? "…" : ""}${text.slice(start, end === -1 ? undefined : end)}${end === -1 ? "" : "…"}`;
    return [{ doc, excerpt, inTitle: words.every((w) => doc.h1.toLowerCase().includes(w)) }];
  });
  return hits.sort((a, b) => Number(b.inTitle) - Number(a.inTitle)).map(({ doc, excerpt }) => ({ doc, excerpt }));
}
