import { DOCS, HEADER, PAGES, SITE, findPage } from "../lib/markdown.mjs";
import { DownloadIcon, Mark } from "./Icons";

/** The logo and the main links. On the home page it sits on the yellow plate. */
export function SiteHeader({ current, plate = false }: { current: string; plate?: boolean }) {
  return (
    <header className={plate ? "masthead masthead--plate" : "masthead"}>
      <div className="wrap masthead__inner">
        <a className="masthead__logo" href="/" aria-label="ClipCat home">
          <Mark className="masthead__mark" />
          <span className="masthead__name">ClipCat</span>
        </a>
        <nav aria-label="Main">
          <ul className="masthead__nav">
            {HEADER.map((path) => (
              <li key={path}>
                <a href={path} aria-current={path === current ? "page" : current.startsWith(`${path}/`) ? "true" : undefined}>
                  {findPage(path)!.nav}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}

/** The two installers. `plate` is for the yellow plates, where buttons are ink. */
export function Downloads({ plate = false }: { plate?: boolean }) {
  return (
    <div className="downloads">
      <div className="downloads__buttons">
        <a className={plate ? "button button--ink" : "button button--accent"} href={SITE.mac}>
          <DownloadIcon />
          Download for Mac
        </a>
        <a className={plate ? "button button--ink-outline" : "button button--secondary"} href={SITE.windows}>
          <DownloadIcon />
          Download for Windows
        </a>
      </div>
      <p className="downloads__note">
        Apple Silicon with macOS 14 or newer (<a href={SITE.macIntel}>Intel Mac version</a>), or 64-bit Windows 10 and 11.{" "}
        <a href={SITE.releases} rel="noopener">All releases</a>
      </p>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="wrap footer__inner">
        <a className="footer__logo" href="/" aria-label="ClipCat home">
          <Mark className="footer__mark" />
          <span>ClipCat</span>
        </a>
        <nav aria-label="Site">
          <ul className="footer__links">
            {[...PAGES, DOCS[0]!].map((p) => (
              <li key={p.path}>
                <a href={p.path}>{p.nav}</a>
              </li>
            ))}
            <li>
              <a href={SITE.repo} rel="noopener">
                Source on GitHub
              </a>
            </li>
          </ul>
        </nav>
        <p className="footer__note">A free, personal project, shared as is. Set in Jost, under the SIL Open Font License.</p>
      </div>
    </footer>
  );
}
