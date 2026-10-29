import { Search } from "lucide-react";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { ICON_STROKE } from "../icons";
import { DOCS, pageHref, pageHtml, searchDocs } from "./docs";

type Place = { slug: string; hash: string };

/** The page and part the address points at; an unknown page is the overview. */
function placeOf(location: Location): Place {
  const slug = new URLSearchParams(location.search).get("page") ?? "";
  return { slug: DOCS.some((d) => d.slug === slug) ? slug : "", hash: location.hash };
}

/** The heading id a #part names; a malformed escape is taken as written. */
const decodeHash = (hash: string) => {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
};

const longDate = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { dateStyle: "long" });

/**
 * The Help window: a search box and the list of pages on the left, the open
 * page on the right. Links between pages turn the page here, links out of the
 * help open in the browser, and Back and Forward work like a browser's.
 */
export function HelpWindow() {
  const [place, setPlace] = useState(() => placeOf(window.location));
  const [query, setQuery] = useState("");
  const page = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const at = DOCS.findIndex((d) => d.slug === place.slug);
  const doc = DOCS[at]!;
  const next = DOCS[at + 1];
  const html = useMemo(() => pageHtml(doc), [doc]);
  const hits = useMemo(() => searchDocs(query), [query]);

  useEffect(() => {
    const back = () => setPlace(placeOf(window.location));
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);

  // ⌘F or Ctrl+F goes to the search box, as it would in a browser.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  useEffect(() => {
    document.title = doc.slug ? `${doc.h1} · ClipCat Help` : "ClipCat Help";
    const target = place.hash ? document.getElementById(decodeHash(place.hash)) : null;
    if (target) target.scrollIntoView();
    else if (page.current) page.current.scrollTop = 0;
  }, [doc, place]);

  const go = (slug: string, hash = "") => {
    window.history.pushState(null, "", pageHref(slug, hash));
    setPlace({ slug, hash });
  };

  /** Links in a page: another help page turns the page, a web link opens in the browser, a #part scrolls as usual. */
  const follow = (e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest("a");
    if (!link || e.defaultPrevented) return;
    const href = link.getAttribute("href") ?? "";
    if (link.hasAttribute("data-external")) {
      e.preventDefault();
      window.open(href);
    } else if (href.startsWith("?page=")) {
      e.preventDefault();
      const url = new URL(href, window.location.href);
      go(url.searchParams.get("page") ?? "", url.hash);
    }
  };

  const pageLink = (slug: string, label: string, extra?: string) => (
    <a
      href={pageHref(slug)}
      aria-current={!query && slug === doc.slug ? "page" : undefined}
      onClick={(e) => {
        e.preventDefault();
        go(slug);
      }}
    >
      <span className="help__item-title">{label}</span>
      {extra && <span className="help__excerpt">{extra}</span>}
    </a>
  );

  return (
    <div className="help">
      <nav className="help__side" aria-label="Help pages">
        <label className="help__search">
          <Search className="help__search-icon" strokeWidth={ICON_STROKE} aria-hidden />
          <span className="visually-hidden">Search the help</span>
          <input ref={search} type="search" placeholder="Search the help" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {query ? (
          hits.length ? (
            <ol className="help__list" aria-label="Pages that match">
              {hits.map((hit) => (
                <li key={hit.doc.slug}>{pageLink(hit.doc.slug, hit.doc.slug ? hit.doc.h1 : "Overview", hit.excerpt)}</li>
              ))}
            </ol>
          ) : (
            <p className="help__empty">No page mentions “{query.trim()}”. Try a shorter word.</p>
          )
        ) : (
          <ol className="help__list">
            {DOCS.map((d) => (
              <li key={d.slug}>{pageLink(d.slug, d.slug ? d.h1 : "Overview")}</li>
            ))}
          </ol>
        )}
      </nav>
      <main className="help__page" ref={page}>
        <article className="help__article" onClick={follow}>
          <h1>{doc.h1}</h1>
          <div className="help__body" dangerouslySetInnerHTML={{ __html: html }} />
          {next && (
            <p className="help__next">
              Next:{" "}
              <a
                href={pageHref(next.slug)}
                onClick={(e) => {
                  e.preventDefault();
                  go(next.slug);
                }}
              >
                {next.h1}
              </a>
            </p>
          )}
          <p className="help__updated">
            Last updated <time dateTime={doc.updated}>{longDate(doc.updated)}</time>.
          </p>
        </article>
      </main>
    </div>
  );
}
