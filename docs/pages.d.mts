// Types for pages.mjs, for the app's TypeScript.

export type Doc = {
  /** "" for README.md, the index page. */
  slug: string;
  title: string;
  description: string;
  order: number;
  updated: string;
  h1: string;
  /** The page without its front matter. */
  markdown: string;
};

export function headingId(text: string): string;
export function parseDoc(file: string, text: string): Doc;
export function parseDocs(files: Record<string, string>): Doc[];
export function docLink(href: string): { slug: string; hash: string } | null;
export function rewriteLinks(markdown: string, to: (slug: string, hash: string) => string): string;
export function renderDoc(markdown: string, to: (slug: string, hash: string) => string): string;
