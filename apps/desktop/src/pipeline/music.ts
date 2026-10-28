// Music under the video: the user picks a file, it goes on the project at
// once (the export mixes the original), and a copy the preview can play is
// prepared on the project's queue. `resume` prepares whatever an earlier run
// didn't.

import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Project } from "@clipcat/core";
import type { JobContext, JobQueue } from "../jobs/queue";
import type { ProjectStore } from "../store/projects";

export type MusicDeps = {
  store: ProjectStore;
  queue: JobQueue;
  /** The music's length in seconds; throws when it has no sound. */
  probe: (file: string) => Promise<number>;
  /** Writes the preview copy (an absolute path). */
  prep: (file: string, duration: number, out: string, ctx: JobContext) => Promise<void>;
  changed: (project: Project) => void;
};

export const MUSIC_DIR = "media/music";

export class MusicPipeline {
  constructor(private readonly deps: MusicDeps) {}

  /** Puts `file` under the video, keeping the volume and ducking of the music it replaces. */
  async set(projectId: string, file: string): Promise<Project> {
    let duration: number;
    try {
      duration = await this.deps.probe(file);
    } catch (e) {
      throw new Error(`${basename(file)}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const project = await this.deps.store.update(projectId, null, (p) => {
      p.music = { path: file, name: basename(file), duration, volume: p.music?.volume ?? 0.15, duck: p.music?.duck ?? true, prep: null };
    });
    await this.deps.store.log(projectId, { type: "music-set", file });
    this.deps.changed(project);
    this.enqueue(projectId, file);
    return project;
  }

  /** Prepares music an earlier run left unprepared. */
  async resume(): Promise<void> {
    for (const summary of await this.deps.store.list()) {
      const p = await this.deps.store.get(summary.id);
      if (p.music && !p.music.prep) this.enqueue(p.id, p.music.path);
    }
  }

  /** Deletes the prepared copies once the music is taken out. */
  async forget(projectId: string): Promise<void> {
    await rm(join(this.deps.store.dir(projectId), MUSIC_DIR), { recursive: true, force: true });
  }

  private enqueue(projectId: string, file: string): void {
    this.deps.queue.add(projectId, "music", `Preparing ${basename(file)}`, (ctx) => this.runPrep(projectId, file, ctx)).catch(() => {});
  }

  async runPrep(projectId: string, file: string, ctx: JobContext): Promise<void> {
    const music = (await this.deps.store.get(projectId)).music;
    if (music?.path !== file || music.prep) return; // replaced or removed while queued
    const rel = `${MUSIC_DIR}/${randomUUID().slice(0, 8)}.m4a`;
    const root = this.deps.store.dir(projectId);
    // Earlier copies go: only the current music is ever played.
    await rm(join(root, MUSIC_DIR), { recursive: true, force: true });
    await mkdir(join(root, MUSIC_DIR), { recursive: true });
    await this.deps.prep(file, music.duration, join(root, rel), ctx);
    this.deps.changed(
      await this.deps.store.update(projectId, null, (p) => {
        if (p.music?.path === file) p.music.prep = rel;
      }),
    );
  }
}
