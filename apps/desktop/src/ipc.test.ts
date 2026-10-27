import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: {}, net: {}, protocol: {} }));
import { isTrustedSender } from "./ipc";

describe("isTrustedSender", () => {
  it("trusts the packaged UI", () => {
    expect(isTrustedSender("app://clipcat/index.html", null)).toBe(true);
  });

  it("trusts the dev server only in development", () => {
    expect(isTrustedSender("http://localhost:5173/", "http://localhost:5173/")).toBe(true);
    expect(isTrustedSender("http://localhost:5173/", null)).toBe(false);
  });

  it("refuses anything else", () => {
    expect(isTrustedSender("https://example.com/", null)).toBe(false);
    expect(isTrustedSender("app://evil/index.html", null)).toBe(false);
    expect(isTrustedSender("file:///tmp/x.html", null)).toBe(false);
    expect(isTrustedSender(undefined, null)).toBe(false);
  });
});
