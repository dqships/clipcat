import { Downloads } from "./Chrome";
import { Mark } from "./Icons";
import { Inline } from "./Inline";
import { Timeline } from "./Timeline";
import type { Page, Section } from "./types";

function Body({ s }: { s: Section }) {
  return (
    <>
      {s.body?.map((p) => (
        <p className="section__body" key={p}>
          <Inline text={p} />
        </p>
      ))}
    </>
  );
}

function More({ s }: { s: Section }) {
  return s.more ? (
    <p className="more">
      <Inline text={s.more} />
    </p>
  ) : null;
}

/** The yellow plate: the poster line, the pitch and the installers, with the mark cropped off the edge. */
export function Hero({ page }: { page: Page }) {
  // The poster breaks after each sentence, and never leaves one word alone on a line.
  const lines = page.h1.split(/(?<=\.) /).map((line) => line.replace(/ (?=\S+$)/, "\u00a0"));
  return (
    <div className="hero">
      <div className="wrap hero__inner">
        {page.kicker && <p className="hero__kicker">{page.kicker}</p>}
        <h1 className="hero__title">
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h1>
        <p className="hero__lede">
          <Inline text={page.lede} />
        </p>
        <Downloads plate />
      </div>
      <Mark className="hero__mark" />
    </div>
  );
}

export function HomeSection({ s }: { s: Section }) {
  switch (s.kind) {
    case "timeline":
      return (
        <section className="wrap home-timeline" aria-label="An example first edit">
          <Timeline caption={s.caption!} />
        </section>
      );
    case "features":
      return (
        <section className="wrap section">
          <div className="section__intro">
            <h2>{s.h2}</h2>
            <Body s={s} />
          </div>
          <ul className="features">
            {s.cards!.map((c) => (
              <li className="feature" key={c.title}>
                <span className="track-chip">{c.track}</span>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
              </li>
            ))}
          </ul>
          <More s={s} />
        </section>
      );
    case "shorts":
      return (
        <section className="band">
          <div className="wrap section shorts">
            <div className="section__intro">
              <h2>{s.h2}</h2>
              <Body s={s} />
              {s.note && <p className="note">{s.note}</p>}
            </div>
            <ul className="shorts__phones" aria-label="Three example shorts">
              {s.shorts!.map((sh, i) => (
                <li className={`phone phone--${i + 1}`} key={sh.length}>
                  <span className="phone__length">Short {i + 1} · {sh.length}</span>
                  <span className="phone__person" aria-hidden="true" />
                  <span className="phone__caption">
                    {sh.caption} <mark>{sh.key}</mark> {sh.rest}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      );
    case "agents":
      return (
        <section className="wrap section">
          <div className="section__intro">
            <h2>{s.h2}</h2>
            <Body s={s} />
          </div>
          <ul className="agents">
            {s.cards!.map((c) => (
              <li className="agent" key={c.title}>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
              </li>
            ))}
          </ul>
          <div className="mcp">
            <div className="mcp__text">
              <h3>{s.h3}</h3>
              <p className="section__body">{s.detail}</p>
              <More s={s} />
            </div>
            <pre className="mcp__session" aria-label="An agent editing a project through ClipCat">
              <code>{s.session!.join("\n")}</code>
            </pre>
          </div>
        </section>
      );
    case "facts":
      return (
        <section className="wrap section">
          <h2>{s.h2}</h2>
          <ul className="facts">
            {s.cards!.map((c) => (
              <li className="fact" key={c.title}>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
              </li>
            ))}
          </ul>
          <More s={s} />
        </section>
      );
    case "end":
      return (
        <section className="end">
          <div className="wrap end__inner">
            <div className="end__text">
              <h2>{s.h2}</h2>
              <Body s={s} />
            </div>
            <Downloads plate />
          </div>
        </section>
      );
    default:
      return (
        <section className="wrap section">
          <h2>{s.h2}</h2>
          <Body s={s} />
          {s.steps && (
            <ol className="steps">
              {s.steps.map((st) => (
                <li className="step" key={st.title}>
                  <h3>{st.title}</h3>
                  <p>
                    <Inline text={st.text} />
                  </p>
                </li>
              ))}
            </ol>
          )}
          <More s={s} />
        </section>
      );
  }
}
