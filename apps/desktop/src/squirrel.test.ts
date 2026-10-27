import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { quit: vi.fn() } }));
const { squirrelEvent } = await import("./squirrel");

describe("squirrelEvent", () => {
  it("reads install events on Windows only", () => {
    expect(squirrelEvent(["ClipCat.exe", "--squirrel-install"], "win32")).toBe("--squirrel-install");
    expect(squirrelEvent(["ClipCat", "--squirrel-install"], "darwin")).toBeNull();
  });

  it("treats first run and normal launches as launches", () => {
    expect(squirrelEvent(["ClipCat.exe", "--squirrel-firstrun"], "win32")).toBeNull();
    expect(squirrelEvent(["ClipCat.exe"], "win32")).toBeNull();
  });
});
