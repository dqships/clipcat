// Updates from the release feed: a base URL where each release's files sit
// side by side (GitHub's `releases/latest/download` works), set as
// `clipcat.updateFeed` in apps/desktop/package.json. Windows asks Squirrel at
// the base URL (it reads RELEASES and the nupkg); macOS reads RELEASES.json,
// which the ZIP maker writes. Squirrel.Mac only installs into a signed app, so
// an unsigned Mac build checks RELEASES.json itself and offers the download
// page instead of installing.

import type { UpdateStatusValue } from "@clipcat/ipc";

/** "0.10.2" > "0.9.9": dotted numbers compared in turn; a pre-release tag is ignored. */
export function newer(candidate: string, current: string): boolean {
  const parts = (v: string) => v.replace(/^v/, "").split(/[-+]/)[0]!.split(".").map((n) => Number(n) || 0);
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** The page a person downloads from: the feed's release page rather than its file folder. */
export function releasePage(feed: string): string {
  return feed.replace(/\/download\/?$/, "");
}

/** What Squirrel is pointed at on each system. */
export function feedFor(feed: string, platform: string): { url: string; serverType?: "json" | "default" } {
  const base = feed.replace(/\/$/, "");
  return platform === "darwin" ? { url: `${base}/RELEASES.json`, serverType: "json" } : { url: base };
}

/** The part of Electron's autoUpdater this uses, so it can be stood in for. */
export type AutoUpdater = {
  setFeedURL(options: { url: string; serverType?: "json" | "default" }): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "update-available" | "update-not-available", listener: () => void): unknown;
  on(event: "update-downloaded", listener: (event: unknown, notes: string, name: string) => void): unknown;
};

export type UpdaterDeps = {
  feed: string | null;
  version: string;
  platform: string;
  /** Whether this copy can update itself; false for a dev run, a smoke run or Squirrel's own launches. */
  enabled: boolean;
  autoUpdater: AutoUpdater;
  /** Fetches JSON; throws on a failed request. */
  fetchJson: (url: string) => Promise<unknown>;
  onChange: (status: UpdateStatusValue) => void;
  now: () => Date;
};

const EVERY = 4 * 60 * 60 * 1000;

export class Updater {
  private status: UpdateStatusValue;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Set once Squirrel.Mac has refused (an unsigned app): from then on only offer the download. */
  private manual = false;

  constructor(private readonly deps: UpdaterDeps) {
    this.status = { state: deps.enabled && deps.feed ? "idle" : "off", version: null, detail: null, page: deps.feed ? releasePage(deps.feed) : null, checkedAt: null };
  }

  get current(): UpdateStatusValue {
    return this.status;
  }

  start(): void {
    const { feed, enabled, autoUpdater, platform } = this.deps;
    if (!enabled || !feed) return;
    autoUpdater.setFeedURL(feedFor(feed, platform));
    autoUpdater.on("update-available", () => this.set({ state: "downloading" }));
    autoUpdater.on("update-not-available", () => this.set({ state: "idle" }));
    autoUpdater.on("update-downloaded", (_event, _notes, name) =>
      this.set({ state: "ready", version: name?.replace(/^\D*/, "") || this.status.version, detail: null }),
    );
    autoUpdater.on("error", (error) => {
      // Squirrel.Mac says so when the running app isn't signed; the download page is all that's left.
      if (platform === "darwin" && /code signature|not signed|signing/i.test(error.message)) {
        this.manual = true;
        return this.set({ state: this.status.version ? "available" : "idle", detail: null });
      }
      this.set({ state: "error", detail: error.message });
    });
    void this.check();
    this.timer = setInterval(() => void this.check(), EVERY);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Looks for a newer release; on a Mac it reads the feed first, so it can name the version. */
  async check(): Promise<UpdateStatusValue> {
    const { feed, enabled, platform, autoUpdater } = this.deps;
    if (!enabled || !feed || this.status.state === "ready" || this.status.state === "downloading") return this.status;
    this.set({ state: "checking", detail: null, checkedAt: this.deps.now().toISOString() });
    if (platform !== "darwin") {
      autoUpdater.checkForUpdates();
      return this.status;
    }
    try {
      const manifest = (await this.deps.fetchJson(feedFor(feed, platform).url)) as { currentRelease?: unknown };
      const latest = typeof manifest.currentRelease === "string" ? manifest.currentRelease : null;
      if (!latest || !newer(latest, this.deps.version)) return this.set({ state: "idle", version: null });
      this.set({ version: latest });
      if (this.manual) return this.set({ state: "available" });
      autoUpdater.checkForUpdates();
    } catch (e) {
      this.set({ state: "error", detail: `Couldn't check for updates: ${e instanceof Error ? e.message : String(e)}` });
    }
    return this.status;
  }

  install(): void {
    if (this.status.state === "ready") this.deps.autoUpdater.quitAndInstall();
  }

  private set(change: Partial<UpdateStatusValue>): UpdateStatusValue {
    this.status = { ...this.status, ...change };
    this.deps.onChange(this.status);
    return this.status;
  }
}
