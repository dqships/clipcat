import type { LucideIcon } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ICON_STROKE } from "./icons";

export type MenuItem = { label: string; icon: LucideIcon; onSelect: () => void; danger?: boolean };

type Props = {
  label: string;
  /** Where the menu opens: the pointer for a right-click, or under a button. */
  at: { x: number; y: number };
  items: MenuItem[];
  onClose: () => void;
};

/**
 * A small menu of actions, opened by a right-click, a long press or a button.
 * It takes focus, moves with the arrow keys, and closes on Escape, a pick or
 * a click anywhere else.
 */
export function Menu({ label, at, items, onClose }: Props) {
  const menu = useRef<HTMLUListElement>(null);
  const [place, setPlace] = useState(at);

  // Keep the whole menu on screen.
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect();
    if (!box) return;
    setPlace({ x: Math.max(0, Math.min(at.x, window.innerWidth - box.width)), y: Math.max(0, Math.min(at.y, window.innerHeight - box.height)) });
  }, [at]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const away = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) onClose();
    };
    const blur = () => onClose();
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", blur);
      if (opener?.isConnected && !menu.current?.contains(document.activeElement)) opener.focus();
    };
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent) => {
    const all = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "ArrowDown" ? (at + 1) % all.length : e.key === "ArrowUp" ? (at - 1 + all.length) % all.length : e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : null;
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose();
    } else if (next !== null) {
      e.preventDefault();
      all[next]?.focus();
    }
  };

  return (
    <ul ref={menu} className="menu" role="menu" aria-label={label} style={{ left: place.x, top: place.y }} onKeyDown={onKeyDown}>
      {items.map(({ label, icon: Icon, onSelect, danger }) => (
        <li key={label} role="none">
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={danger ? "menu__item menu__item--danger" : "menu__item"}
            onClick={() => {
              onClose();
              onSelect();
            }}
          >
            <Icon className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
            {label}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** How long a press is held before it opens the menu, for touch and pens. */
const HOLD = 500;

/**
 * Props that open a menu on right-click or on a long press. `open` gets the
 * spot to open it at.
 */
export function useMenuTrigger(open: (at: { x: number; y: number }) => void) {
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  return {
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      stop();
      open({ x: e.clientX, y: e.clientY });
    },
    onPointerDown: (e: ReactPointerEvent) => {
      held.current = false;
      if (e.pointerType === "mouse") return;
      const { clientX: x, clientY: y } = e;
      stop();
      timer.current = window.setTimeout(() => {
        held.current = true;
        open({ x, y });
      }, HOLD);
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    // A press that opened the menu isn't also a click on what's under it.
    onClickCapture: (e: MouseEvent) => {
      if (!held.current) return;
      held.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
