import type { ReactNode } from "react";

/** A page's heading and the sentence under it. */
export function PageHead({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <header className="settings__head">
      <h2 id={id} className="settings__title">
        {title}
      </h2>
      <p className="settings__body">{children}</p>
    </header>
  );
}

/** A labelled part of a page, set off by a hairline. */
export function Group({ id, label, className, children }: { id: string; label: string; className?: string; children: ReactNode }) {
  return (
    <section className={className ? `settings__group ${className}` : "settings__group"} aria-labelledby={id}>
      <h3 id={id} className="settings__label">
        {label}
      </h3>
      {children}
    </section>
  );
}
