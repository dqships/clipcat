import { HEADER, NOT_FOUND, PAGES, SITE, jsonLd, longDate } from "../lib/markdown.mjs";
import { siteOrigin } from "../lib/site.mjs";
import { Inline } from "./Inline";

type Section = {
  h2?: string;
  body?: string[];
  list?: string[];
  steps?: { title: string; text: string }[];
  cards?: { title: string; text: string }[];
  download?: boolean;
  pageList?: boolean;
  more?: string;
};
export type Page = { path: string; title: string; description: string; h1: string; lede: string; hero?: boolean; updated?: string; sections: Section[] };

function Downloads() {
  return (
    <>
      <div className="downloads">
        <a className="button button--accent" href={SITE.mac}>Download for Mac</a>
        <a className="button button--secondary" href={SITE.windows}>Download for Windows</a>
      </div>
      <p className="downloads__note">
        Apple Silicon, macOS 14 or newer. 64-bit Windows 10 or 11. <a href={SITE.releases} rel="noopener">All releases</a>.
      </p>
    </>
  );
}

function SectionView({ s }: { s: Section }) {
  return (
    <section className="section">
      {s.h2 && <h2>{s.h2}</h2>}
      {s.body?.map((p) => <p key={p}><Inline text={p} /></p>)}
      {s.list && <ul className="list">{s.list.map((i) => <li key={i}><Inline text={i} /></li>)}</ul>}
      {s.steps && (
        <ol className="steps">
          {s.steps.map((st) => <li className="steps__item" key={st.title}><h3>{st.title}</h3><p><Inline text={st.text} /></p></li>)}
        </ol>
      )}
      {s.cards && <ul className="cards">{s.cards.map((c) => <li className="card" key={c.title}><h3>{c.title}</h3><p><Inline text={c.text} /></p></li>)}</ul>}
      {s.download && <Downloads />}
      {s.pageList && <ul className="list">{PAGES.map((p) => <li key={p.path}><a href={p.path}>{p.nav}</a>: {p.description}</li>)}</ul>}
      {s.more && <p className="more"><Inline text={s.more} /></p>}
    </section>
  );
}

export function PageView({ page }: { page: Page }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(page, siteOrigin()) }} />
      <a className="skip" href="#main">Skip to content</a>
      <header className="masthead">
        <div className="wrap masthead__inner">
          <a className="masthead__logo" href="/">
            <picture>
              <source srcSet="/brand/clipcat-lockup-white.svg" media="(prefers-color-scheme: dark)" />
              <img src="/brand/clipcat-lockup-ink.svg" alt="ClipCat home" width={112} height={32} />
            </picture>
          </a>
          <nav className="masthead__nav" aria-label="Main">
            <ul>
              {HEADER.map((path) => (
                <li key={path}><a href={path} aria-current={path === page.path ? "page" : undefined}>{PAGES.find((p) => p.path === path)!.nav}</a></li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" className="wrap">
        <div className={page.hero ? "hero" : "intro"}>
          <h1>{page.h1}</h1>
          <p className="lede"><Inline text={page.lede} /></p>
          {page.hero && <Downloads />}
        </div>
        {page.sections.map((s, i) => <SectionView s={s} key={i} />)}
        {page.updated && <p className="updated">Last updated <time dateTime={page.updated}>{longDate(page.updated)}</time>.</p>}
      </main>
      <footer className="footer">
        <div className="wrap footer__inner">
          <nav aria-label="Site">
            <ul className="footer__links">
              {PAGES.map((p) => <li key={p.path}><a href={p.path}>{p.nav}</a></li>)}
              <li><a href={SITE.repo} rel="noopener">Source on GitHub</a></li>
            </ul>
          </nav>
          <p className="footer__note">ClipCat is a free, personal project. Fonts: Jost, under the SIL Open Font License.</p>
        </div>
      </footer>
    </>
  );
}

export { NOT_FOUND };
