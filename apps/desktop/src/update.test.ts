import type { UpdateStatusValue } from "@clipcat/ipc";
import { describe, expect, it, vi } from "vitest";
import { type AutoUpdater, Updater, feedFor, newer, releasePage } from "./update";

const FEED = "https://github.com/dqships/clipcat/releases/latest/download";

/** An autoUpdater whose events the test fires by hand. */
function fakeUpdater() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const updater = {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
    on: (event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener),
  };
  const fire = (event: string, ...args: unknown[]) => listeners.get(event)?.(...args);
  return { updater: updater as unknown as AutoUpdater & typeof updater, fire };
}

const make = (over: { platform?: string; arch?: string; enabled?: boolean; feed?: string | null; manifest?: unknown } = {}) => {
  const { updater, fire } = fakeUpdater();
  const seen: UpdateStatusValue[] = [];
  const fetchJson = vi.fn(async () => {
    if (over.manifest instanceof Error) throw over.manifest;
    return over.manifest ?? { currentRelease: "0.1.0" };
  });
  const u = new Updater({
    feed: over.feed === undefined ? FEED : over.feed,
    version: "0.1.0",
    platform: over.platform ?? "darwin",
    arch: over.arch ?? "arm64",
    enabled: over.enabled ?? true,
    autoUpdater: updater,
    fetchJson,
    onChange: (s) => seen.push(s),
    now: () => new Date("2026-10-28T00:00:00Z"),
  });
  return { u, updater, fire, fetchJson, seen };
};

describe("versions and feeds", () => {
  it("compares dotted versions as numbers", () => {
    expect(newer("0.10.0", "0.9.9")).toBe(true);
    expect(newer("v1.0.0", "0.9.0")).toBe(true);
    expect(newer("0.1.0", "0.1.0")).toBe(false);
    expect(newer("0.1.0-beta.1", "0.1.0")).toBe(false);
    expect(newer("0.1", "0.1.1")).toBe(false);
  });

  it("points Squirrel.Mac at its processor's manifest and Squirrel.Windows at the folder", () => {
    expect(feedFor(FEED, "darwin", "arm64")).toEqual({ url: `${FEED}/RELEASES.json`, serverType: "json" });
    expect(feedFor(FEED, "darwin", "x64")).toEqual({ url: `${FEED}/RELEASES-x64.json`, serverType: "json" });
    expect(feedFor(`${FEED}/`, "win32", "x64")).toEqual({ url: FEED });
    expect(releasePage(FEED)).toBe("https://github.com/dqships/clipcat/releases/latest");
  });
});

describe("Updater", () => {
  it("stays off in a dev copy or without a feed", async () => {
    for (const over of [{ enabled: false }, { feed: null }]) {
      const { u, updater } = make(over);
      u.start();
      expect(u.current.state).toBe("off");
      expect(await u.check()).toMatchObject({ state: "off" });
      expect(updater.setFeedURL).not.toHaveBeenCalled();
    }
  });

  it("on a Mac, reads the manifest and lets Squirrel download a newer version, then restarts into it", async () => {
    const { u, updater, fire } = make({ manifest: { currentRelease: "0.2.0" } });
    u.start();
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledOnce());
    expect(updater.setFeedURL).toHaveBeenCalledWith({ url: `${FEED}/RELEASES.json`, serverType: "json" });
    fire("update-available");
    expect(u.current).toMatchObject({ state: "downloading", version: "0.2.0" });
    fire("update-downloaded", {}, "", "ClipCat v0.2.0");
    expect(u.current).toMatchObject({ state: "ready", version: "0.2.0" });
    u.install();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
    u.stop();
  });

  it("on an Intel Mac, reads the Intel manifest", async () => {
    const { u, updater, fetchJson } = make({ arch: "x64", manifest: { currentRelease: "0.2.0" } });
    u.start();
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledOnce());
    expect(fetchJson).toHaveBeenCalledWith(`${FEED}/RELEASES-x64.json`);
    expect(updater.setFeedURL).toHaveBeenCalledWith({ url: `${FEED}/RELEASES-x64.json`, serverType: "json" });
    u.stop();
  });

  it("doesn't bother Squirrel when the manifest has nothing newer", async () => {
    const { u, updater } = make({ manifest: { currentRelease: "0.1.0" } });
    expect(await u.check()).toMatchObject({ state: "idle", checkedAt: "2026-10-28T00:00:00.000Z" });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("offers the download page when an unsigned Mac copy can't install", async () => {
    const { u, updater, fire } = make({ manifest: { currentRelease: "0.2.0" } });
    u.start();
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledOnce());
    fire("error", new Error("Could not get code signature for running application"));
    expect(u.current).toMatchObject({ state: "available", version: "0.2.0", page: "https://github.com/dqships/clipcat/releases/latest" });
    expect(await u.check()).toMatchObject({ state: "available" });
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    u.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    u.stop();
  });

  it("asks Squirrel directly on Windows and reports a failed check", async () => {
    const { u, updater, fire, fetchJson } = make({ platform: "win32" });
    u.start();
    expect(updater.setFeedURL).toHaveBeenCalledWith({ url: FEED });
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(fetchJson).not.toHaveBeenCalled();
    fire("error", new Error("network down"));
    expect(u.current).toMatchObject({ state: "error", detail: "network down" });
    u.stop();

    const offline = make({ manifest: new Error("404 from feed") });
    expect(await offline.u.check()).toMatchObject({ state: "error", detail: "Couldn't check for updates: 404 from feed" });
  });
});
