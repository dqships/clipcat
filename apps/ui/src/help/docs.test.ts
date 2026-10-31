// The Help window's pages: every one in docs/ is there, and every link between
// them lands on a page and a heading that exist.

import { describe, expect, it } from "vitest";
import { DOCS, pageHtml, searchDocs } from "./docs";

describe("the Help window's pages", () => {
  it("has every page, the overview first", () => {
    expect(DOCS.length).toBeGreaterThanOrEqual(20);
    expect(DOCS[0]!.slug).toBe("");
    expect(DOCS.map((d) => d.slug)).toContain("shortcuts");
  });

  it("links only to pages and headings that exist", () => {
    const pages = new Map(DOCS.map((d) => [d.slug, pageHtml(d)]));
    for (const [slug, html] of pages) {
      for (const [, page, hash] of html.matchAll(/href="\?page=([a-z0-9-]*)(?:#([\w-]+))?"/g)) {
        expect(pages.has(page!), `${slug || "README"} links to a missing page ${page}`).toBe(true);
        if (hash) expect(pages.get(page!), `${slug || "README"} links to a missing #${hash} on ${page}`).toContain(`id="${hash}"`);
      }
    }
  });

  it("marks links out of the help, so they open in the browser", () => {
    const troubleshooting = pageHtml(DOCS.find((d) => d.slug === "troubleshooting")!);
    expect(troubleshooting).toMatch(/<a href="https:[^"]+" rel="noopener" data-external="">/);
  });
});

describe("searchDocs", () => {
  it("finds pages with every word, title matches first", () => {
    const hits = searchDocs("keyboard shortcuts");
    expect(hits[0]!.doc.slug).toBe("shortcuts");
    expect(hits.every((h) => h.excerpt.length > 0)).toBe(true);
  });

  it("puts the exact phrase ahead of pages that only share its words", () => {
    const hits = searchDocs("picture in picture");
    expect(hits[0]!.doc.slug).toBe("zooms-and-b-roll");
    expect(hits[0]!.excerpt.toLowerCase()).toContain("picture in picture");
  });

  it("finds nothing for nothing", () => {
    expect(searchDocs("  ")).toEqual([]);
    expect(searchDocs("zzqx")).toEqual([]);
  });
});
