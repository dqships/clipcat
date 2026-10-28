import { Fragment, type ReactNode } from "react";

/** Page copy may hold `[text](url)` links and `**bold**`; everything else is text. */
export function Inline({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      const external = /^https?:/.test(m[2]);
      out.push(
        <a key={m.index} href={m[2]} rel={external ? "noopener" : undefined}>
          {m[1]}
        </a>,
      );
    } else {
      out.push(<strong key={m.index}>{m[3]}</strong>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <Fragment>{out}</Fragment>;
}
