import { describe, expect, it } from "vitest";
import { channelFor, eventChannelFor, events, isMethodName, methods } from "./index";

describe("ipc contract", () => {
  it("prefixes every channel", () => {
    for (const name of Object.keys(methods)) {
      expect(channelFor(name as keyof typeof methods)).toBe(`clipcat:${name}`);
    }
  });

  it("knows its own method names and nothing else", () => {
    expect(isMethodName("app:info")).toBe(true);
    expect(isMethodName("toString")).toBe(false);
    expect(isMethodName("app:delete-everything")).toBe(false);
  });

  it("rejects a malformed app:info result", () => {
    const bad = { name: "ClipCat", version: "0.1.0", platform: "darwin", arch: "arm64", ffmpeg: { available: true } };
    expect(methods["app:info"].output.safeParse(bad).success).toBe(false);
  });

  it("keeps event channels apart from method channels", () => {
    for (const name of Object.keys(events)) {
      expect(eventChannelFor(name as keyof typeof events)).toBe(`clipcat-event:${name}`);
    }
  });

  it("refuses project ids that could leave the projects folder", () => {
    expect(methods["project:get"].input.safeParse({ id: "../etc" }).success).toBe(false);
    expect(methods["project:import"].input.safeParse({ projectId: null, files: [] }).success).toBe(false);
  });
});
