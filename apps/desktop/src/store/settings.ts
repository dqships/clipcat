// App-wide settings, one small JSON file beside the projects folder. A file
// that is missing or unreadable means the defaults.

import { readFile } from "node:fs/promises";
import { Settings, type SettingsValue } from "@clipcat/ipc";
import { writeFileAtomic } from "../atomic";

type Settings = SettingsValue;

export class SettingsStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async get(): Promise<Settings> {
    try {
      return Settings.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch {
      return Settings.parse({});
    }
  }

  /** Merges `patch` in and saves; saves run one after another. */
  set(patch: Partial<Settings>): Promise<Settings> {
    const next = this.queue.then(async () => {
      const merged = Settings.parse({ ...(await this.get()), ...patch });
      await writeFileAtomic(this.file, JSON.stringify(merged, null, 2));
      return merged;
    });
    this.queue = next.catch(() => {});
    return next;
  }
}
