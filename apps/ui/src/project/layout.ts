import { useCallback, useEffect, useState } from "react";

/** Where a panel sits around the preview. */
export type Dock = "left" | "right" | "bottom";
export type PanelId = "transcript" | "controls";

/**
 * The editor's panel layout. Sizes are percentages: a side dock's share of
 * the editor's width, the bottom dock's share of the middle column's height,
 * and, for a dock that holds both panels, the first panel's share of it.
 */
export type Layout = {
  dock: Record<PanelId, Dock>;
  size: Record<Dock, number>;
  split: Record<Dock, number>;
};

export const DOCKS: readonly Dock[] = ["left", "bottom", "right"];
/** Panels share a dock in this order: first on top, or first on the left. */
export const PANELS: readonly PanelId[] = ["transcript", "controls"];

export const DEFAULT_LAYOUT: Layout = {
  dock: { transcript: "right", controls: "bottom" },
  size: { left: 32, right: 36, bottom: 45 },
  split: { left: 50, right: 50, bottom: 50 },
};

export const SIZE_LIMITS = { min: 15, max: 65 };
export const SPLIT_LIMITS = { min: 20, max: 80 };

const KEY = "clipcat.editor.layout";

const clamp = (n: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, n));
const isDock = (v: unknown): v is Dock => v === "left" || v === "right" || v === "bottom";

/** A saved layout, or the default for whatever is missing or broken in it. */
export function parseLayout(raw: string | null): Layout {
  let saved: unknown;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  const s = (saved ?? {}) as Partial<Record<keyof Layout, Record<string, unknown>>>;
  const pick = <K extends string>(keys: readonly K[], from: Record<string, unknown> | undefined, fallback: Record<K, number>, limits: { min: number; max: number }) =>
    Object.fromEntries(keys.map((k) => [k, typeof from?.[k] === "number" && Number.isFinite(from[k]) ? clamp(from[k], limits) : fallback[k]])) as Record<K, number>;
  return {
    dock: Object.fromEntries(PANELS.map((p) => [p, isDock(s.dock?.[p]) ? s.dock[p] : DEFAULT_LAYOUT.dock[p]])) as Record<PanelId, Dock>,
    size: pick(DOCKS, s.size, DEFAULT_LAYOUT.size, SIZE_LIMITS),
    split: pick(DOCKS, s.split, DEFAULT_LAYOUT.split, SPLIT_LIMITS),
  };
}

/** The panels in a dock, in their shared order. */
export function panelsIn(layout: Layout, dock: Dock): PanelId[] {
  return PANELS.filter((p) => layout.dock[p] === dock);
}

export function resized(layout: Layout, dock: Dock, size: number): Layout {
  return { ...layout, size: { ...layout.size, [dock]: Math.round(clamp(size, SIZE_LIMITS)) } };
}

export function splitAt(layout: Layout, dock: Dock, split: number): Layout {
  return { ...layout, split: { ...layout.split, [dock]: Math.round(clamp(split, SPLIT_LIMITS)) } };
}

// Storage can be missing or throw (a locked-down profile); the layout still works, it just isn't remembered.
function load(): Layout {
  try {
    return parseLayout(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function save(layout: Layout) {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // Not remembered this time.
  }
}

/** The editor's panel layout, remembered across projects and launches. */
export function usePanelLayout() {
  const [layout, setLayout] = useState(load);
  useEffect(() => save(layout), [layout]);
  const update = useCallback((change: (prev: Layout) => Layout) => setLayout(change), []);
  const move = useCallback((panel: PanelId, dock: Dock) => update((l) => ({ ...l, dock: { ...l.dock, [panel]: dock } })), [update]);
  const resize = useCallback((dock: Dock, size: number) => update((l) => resized(l, dock, size)), [update]);
  const split = useCallback((dock: Dock, at: number) => update((l) => splitAt(l, dock, at)), [update]);
  return { layout, move, resize, split };
}
