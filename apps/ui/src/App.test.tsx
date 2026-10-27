import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
  delete window.clipcat;
});

describe("App", () => {
  it("shows the empty library with one h1", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 2, name: "No videos yet" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows the ffmpeg version from the main process", async () => {
    const invoke = vi.fn(async (method: string) =>
      method === "app:info"
        ? {
            name: "ClipCat",
            version: "0.1.0",
            platform: "darwin",
            arch: "arm64",
            ffmpeg: { available: true, version: "ffmpeg version 6.1.1", path: "/x/ffmpeg" },
          }
        : undefined,
    );
    window.clipcat = { invoke } as never;
    render(<App />);
    expect(await screen.findByText("ffmpeg version 6.1.1")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("app:ready", { screen: "library" });
  });

  it("says where ffmpeg was expected when it is missing", async () => {
    window.clipcat = {
      invoke: async () => ({
        name: "ClipCat",
        version: "0.1.0",
        platform: "win32",
        arch: "x64",
        ffmpeg: { available: false, version: null, path: "C:\\ClipCat\\ffmpeg.exe" },
      }),
    } as never;
    render(<App />);
    expect(await screen.findByText(/ffmpeg not found at C:\\ClipCat\\ffmpeg.exe/)).toBeTruthy();
  });
});
