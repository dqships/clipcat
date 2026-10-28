import { PanelBottom, PanelLeft, PanelRight } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useState } from "react";
import { ICON_STROKE } from "../icons";
import { DOCKS, type Dock, type PanelId } from "./layout";

const DOCK_ICON = { left: PanelLeft, bottom: PanelBottom, right: PanelRight };
const DOCK_NAME = { left: "on the left", bottom: "at the bottom", right: "on the right" };

type PanelProps = {
  id: PanelId;
  title: string;
  dock: Dock;
  onMove: (dock: Dock) => void;
  /** The panel's share of a dock it splits with the other panel. */
  grow?: number;
  children: ReactNode;
};

/** A panel docked beside or below the preview, with buttons to move it. */
export function DockPanel({ id, title, dock, onMove, grow, children }: PanelProps) {
  return (
    <section className="dock-panel" aria-labelledby={`${id}-title`} style={grow === undefined ? undefined : { flexGrow: grow }}>
      <header className="dock-panel__head">
        <h2 id={`${id}-title`} className="section-title">
          {title}
        </h2>
        <div className="dock-panel__docks" role="group" aria-label={`Move ${title.toLowerCase()}`}>
          {DOCKS.map((d) => {
            const Icon = DOCK_ICON[d];
            const label = `${title} ${DOCK_NAME[d]}`;
            return (
              <button
                key={d}
                type="button"
                className={d === dock ? "dock-button dock-button--on" : "dock-button"}
                aria-label={label}
                aria-pressed={d === dock}
                title={label}
                onClick={() => onMove(d)}
              >
                <Icon className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            );
          })}
        </div>
      </header>
      <div className="dock-panel__body">{children}</div>
    </section>
  );
}

type Grow = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
const SHRINK: Record<Grow, Grow> = { ArrowLeft: "ArrowRight", ArrowRight: "ArrowLeft", ArrowUp: "ArrowDown", ArrowDown: "ArrowUp" };
const STEP = 2;

type ResizerProps = {
  label: string;
  /** "vertical" is a line between columns, dragged sideways. */
  orientation: "vertical" | "horizontal";
  value: number;
  min: number;
  max: number;
  /** The key that makes `value` bigger; the opposite arrow makes it smaller. */
  grow: Grow;
  /** The value for a pointer at this spot. */
  measure: (clientX: number, clientY: number) => number;
  onChange: (value: number) => void;
};

/** The hairline between two areas. Drag it, or focus it and use the arrow keys. */
export function Resizer({ label, orientation, value, min, max, grow, measure, onChange }: ResizerProps) {
  const [dragging, setDragging] = useState(false);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) onChange(measure(e.clientX, e.clientY));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = e.key === grow ? value + STEP : e.key === SHRINK[grow] ? value - STEP : e.key === "Home" ? min : e.key === "End" ? max : null;
    if (next === null) return;
    e.preventDefault();
    onChange(next);
  };

  return (
    <div
      className={`resizer resizer--${orientation}${dragging ? " resizer--dragging" : ""}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
    />
  );
}
