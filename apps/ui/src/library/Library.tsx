import lockupInk from "../../../../brand/logo/clipcat-lockup-ink.svg";
import lockupWhite from "../../../../brand/logo/clipcat-lockup-white.svg";
import { EmptyStrip } from "./EmptyStrip";

/** The first screen: your videos. Empty until import lands in phase 1. */
export function Library() {
  return (
    <>
      <header className="titlebar">
        <picture>
          <source srcSet={lockupWhite} media="(prefers-color-scheme: dark)" />
          <img className="titlebar__logo" src={lockupInk} alt="ClipCat" />
        </picture>
      </header>
      <main className="library">
        <h1 className="visually-hidden">Library</h1>
        <section className="empty" aria-labelledby="empty-title">
          <EmptyStrip />
          <h2 id="empty-title" className="empty__title">
            No videos yet
          </h2>
          <p className="empty__body">
            Drop in your raw takes and ClipCat cuts the retakes and silences, then captions what's left.
          </p>
        </section>
      </main>
    </>
  );
}
