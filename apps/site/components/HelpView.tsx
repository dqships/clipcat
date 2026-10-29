import { DOCS, longDate } from "../lib/markdown.mjs";
import { SiteFooter, SiteHeader } from "./Chrome";
import { Meta } from "./Meta";
import type { Doc } from "./types";

/** The list of help pages, in reading order, with the open one marked. */
function HelpNav({ current }: { current: string }) {
  return (
    <nav className="help__nav" id="help-pages" aria-label="Help pages">
      <h2 className="help__nav-title">Help pages</h2>
      <ol className="help__list">
        {DOCS.map((d) => (
          <li key={d.path}>
            <a href={d.path} aria-current={d.path === current ? "page" : undefined}>
              {d.path === "/docs" ? "Overview" : d.h1}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * A help page: the page itself, from the repo's docs/ folder, beside the list
 * of every help page. On a phone the list moves under the page, and a link at
 * the top jumps to it.
 */
export function HelpView({ doc }: { doc: Doc }) {
  const at = DOCS.findIndex((d) => d.path === doc.path);
  const next = DOCS[at + 1];
  return (
    <>
      <Meta page={doc} />
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteHeader current={doc.path} />
      <main id="main" className="doc">
        <div className="wrap help">
          <article className="help__page">
            <div className="doc-intro">
              <h1>{doc.h1}</h1>
              <a className="help__jump" href="#help-pages">
                All help pages
              </a>
            </div>
            <div className="help__body" dangerouslySetInnerHTML={{ __html: doc.html }} />
            {next && (
              <p className="help__next">
                Next: <a href={next.path}>{next.h1}</a>
              </p>
            )}
            <p className="updated help__updated">
              Last updated <time dateTime={doc.updated}>{longDate(doc.updated)}</time>.
            </p>
          </article>
          <HelpNav current={doc.path} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
