import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, panelsIn, parseLayout, resized, splitAt } from "./layout";

describe("panel layout", () => {
  it("starts with the transcript on the right and the controls below the preview", () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(panelsIn(DEFAULT_LAYOUT, "right")).toEqual(["transcript"]);
    expect(panelsIn(DEFAULT_LAYOUT, "bottom")).toEqual(["controls"]);
    expect(panelsIn(DEFAULT_LAYOUT, "left")).toEqual([]);
  });

  it("keeps what it can from a saved layout and defaults the rest", () => {
    const saved = parseLayout(JSON.stringify({ dock: { transcript: "left", controls: "middle" }, size: { left: 90, right: "wide" }, split: { bottom: 5 } }));
    expect(saved.dock).toEqual({ transcript: "left", controls: "bottom" });
    expect(saved.size).toEqual({ left: 65, right: DEFAULT_LAYOUT.size.right, bottom: DEFAULT_LAYOUT.size.bottom });
    expect(saved.split.bottom).toBe(20);
    expect(parseLayout("{not json")).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout("[1]")).toEqual(DEFAULT_LAYOUT);
  });

  it("puts the transcript first when both panels share a dock", () => {
    const both = { ...DEFAULT_LAYOUT, dock: { controls: "left", transcript: "left" } } as const;
    expect(panelsIn(both, "left")).toEqual(["transcript", "controls"]);
  });

  it("rounds and limits sizes and splits", () => {
    expect(resized(DEFAULT_LAYOUT, "left", 3).size.left).toBe(15);
    expect(resized(DEFAULT_LAYOUT, "bottom", 40.6).size.bottom).toBe(41);
    expect(splitAt(DEFAULT_LAYOUT, "right", 99).split.right).toBe(80);
  });
});
