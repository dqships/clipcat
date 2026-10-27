import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: {}, net: {}, protocol: {} }));
import { parseRange, resolveInside } from "./protocol";

const root = join("/opt", "clipcat", "ui");

describe("resolveInside", () => {
  it("maps the root to index.html", () => {
    expect(resolveInside(root, "/")).toBe(join(root, "index.html"));
  });

  it("maps a nested asset", () => {
    expect(resolveInside(root, "/assets/index-abc.js")).toBe(join(root, "assets", "index-abc.js"));
  });

  it("refuses to climb out of the UI folder", () => {
    for (const path of ["/%2e%2e/%2e%2e/etc/passwd", "/..%2f..%2fetc/passwd", "/assets/../../secret"]) {
      const resolved = resolveInside(root, path);
      expect(resolved === null || resolved.startsWith(root)).toBe(true);
    }
  });

  it("refuses malformed escapes", () => {
    expect(resolveInside(root, "/%E0%A4%A")).toBeNull();
  });
});

describe("parseRange", () => {
  it("reads the ranges a video element sends", () => {
    expect(parseRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=500-5000", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("refuses what it can't satisfy", () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("bytes=1000-", 1000)).toBeNull();
    expect(parseRange("bytes=5-1", 1000)).toBeNull();
    expect(parseRange("bytes=0-1,5-9", 1000)).toBeNull();
    expect(parseRange("bytes=-", 1000)).toBeNull();
  });
});
