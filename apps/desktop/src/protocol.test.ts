import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: {}, net: {}, protocol: {} }));
import { resolveInside } from "./protocol";

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
