import { PAGES, longDate } from "../lib/markdown.mjs";
import { Downloads, SiteFooter, SiteHeader } from "./Chrome";
import { Hero, HomeSection } from "./Home";
import { Inline } from "./Inline";
import { Meta } from "./Meta";
import type { Page, Section } from "./types";

/** A section of an inner page: its heading in the left column, its content on the right. */
function PageSection({ s }: { s: Section }) {
  return (
    <section className="doc-section">
      <h2>{s.h2}</h2>
      <div className="doc-section__content">
        {s.body?.map((p) => (
          <p key={p}>
            <Inline text={p} />
          </p>
        ))}
        {s.steps && (
          <ol className="doc-steps">
            {s.steps.map((st) => (
              <li key={st.title}>
                <h3>{st.title}</h3>
                <p>
                  <Inline text={st.text} />
                </p>
              </li>
            ))}
          </ol>
        )}
        {s.prompts && (
          <ul className="doc-prompts" aria-label="Example prompts">
            {s.prompts.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {s.list && (
          <ul className="doc-list">
            {s.list.map((i) => (
              <li key={i}>
                <Inline text={i} />
              </li>
            ))}
          </ul>
        )}
        {s.download && <Downloads />}
        {s.pageList && (
          <ul className="doc-list">
            {PAGES.map((p) => (
              <li key={p.path}>
                <a href={p.path}>{p.nav}</a>: {p.description}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function PageView({ page }: { page: Page }) {
  const home = Boolean(page.hero);
  return (
    <>
      <Meta page={page} />
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteHeader current={page.path} plate={home} />
      <main id="main" className={home ? "home" : "doc"}>
        {home ? (
          <>
            <Hero page={page} />
            {page.sections.map((s, i) => (
              <HomeSection s={s} key={i} />
            ))}
          </>
        ) : (
          <div className="wrap">
            <div className="doc-intro">
              <h1>{page.h1}</h1>
              <p className="doc-intro__lede">
                <Inline text={page.lede} />
              </p>
            </div>
            {page.sections.map((s, i) => (
              <PageSection s={s} key={i} />
            ))}
          </div>
        )}
        {page.updated && !home && (
          <p className="wrap updated">
            Last updated <time dateTime={page.updated}>{longDate(page.updated)}</time>.
          </p>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
