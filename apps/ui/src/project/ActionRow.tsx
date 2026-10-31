import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ICON_STROKE } from "../icons";

/** How far from an end still counts as there, since scrolling lands on fractions of a pixel. */
const SLACK = 1;

/** How much of the row one chevron moves, leaving the last action or two in sight. */
const STEP = 0.75;

/**
 * One row of actions. It stays one row, because wrapping would move the words
 * below it between the two clicks of a double-click. What doesn't fit stays a
 * chevron away, and the chevrons only show when there's more that way.
 */
export function ActionRow({ children }: { children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  const measure = () => {
    const el = row.current;
    if (!el) return;
    const left = el.scrollLeft > SLACK;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - SLACK;
    setMore((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  };

  // The actions change with the selection, so every render measures again.
  useLayoutEffect(measure);
  useEffect(() => {
    if (!row.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(row.current);
    return () => observer.disconnect();
  }, []);

  const move = (way: -1 | 1) => row.current?.scrollBy({ left: way * row.current.clientWidth * STEP });

  return (
    <div className="editor__bar">
      {more.left && (
        <button type="button" className="button editor__more" aria-label="Earlier actions" title="Earlier actions" onClick={() => move(-1)}>
          <ChevronLeft className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
        </button>
      )}
      <div ref={row} className="editor__actions" aria-live="polite" onScroll={measure}>
        {children}
      </div>
      {more.right && (
        <button type="button" className="button editor__more" aria-label="More actions" title="More actions" onClick={() => move(1)}>
          <ChevronRight className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
        </button>
      )}
    </div>
  );
}
