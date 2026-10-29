// The projects opened most recently, newest first, for File > Open Recent:
// one small JSON file of ids. A file that is missing or unreadable means none.

import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../atomic";

export const RECENT_LIMIT = 10;

export class RecentProjects {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async list(): Promise<string[]> {
    try {
      const ids: unknown = JSON.parse(await readFile(this.file, "utf8"));
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string").slice(0, RECENT_LIMIT) : [];
    } catch {
      return [];
    }
  }

  /** Moves a project to the top; saves run one after another. */
  opened(id: string): Promise<string[]> {
    return this.save((ids) => [id, ...ids.filter((i) => i !== id)].slice(0, RECENT_LIMIT));
  }

  clear(): Promise<string[]> {
    return this.save(() => []);
  }

  private save(change: (ids: string[]) => string[]): Promise<string[]> {
    const next = this.queue.then(async () => {
      const ids = change(await this.list());
      await writeFileAtomic(this.file, JSON.stringify(ids));
      return ids;
    });
    this.queue = next.catch(() => {});
    return next;
  }
}
