// Music under the video: the user picks a file, it joins the project's tracks
// at once (the export mixes the original), and a copy the preview can play is
// prepared on the project's queue. `resume` prepares whatever an earlier run
// didn't.

import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
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

  /**
   * Adds `file` as a track, with the volume and ducking of the last one. The
   * first track plays under the whole video; the others wait to be placed.
   * A file that's already a track stays as it is.
   */
  async add(projectId: string, file: string): Promise<Project> {
    let duration: number;
    try {
      duration = await this.deps.probe(file);
    } catch (e) {
      throw new Error(`${basename(file)}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const id = `t${randomUUID().slice(0, 8)}`;
    let added = false;
    const project = await this.deps.store.update(projectId, null, (p) => {
      if (p.music.some((t) => t.path === file)) return;
      const last = p.music.at(-1);
      p.music.push({ id, path: file, name: basename(file), duration, volume: last?.volume ?? 0.15, duck: last?.duck ?? true, prep: null, description: "", whole: p.music.length === 0 });
      added = true;
    });
    if (!added) return project;
    await this.deps.store.log(projectId, { type: "music-added", file });
    this.deps.changed(project);
    this.enqueue(projectId, id, file);
    return project;
  }

  /** Prepares music an earlier run left unprepared. */
  async resume(): Promise<void> {
    for (const summary of await this.deps.store.list()) {
      const p = await this.deps.store.get(summary.id);
      for (const t of p.music) if (!t.prep) this.enqueue(p.id, t.id, t.path);
    }
  }

  /** Deletes the prepared copies no track uses any more. */
  async forget(projectId: string): Promise<void> {
    const project = await this.deps.store.get(projectId);
    const used = new Set(project.music.map((t) => t.prep));
    const dir = join(this.deps.store.dir(projectId), MUSIC_DIR);
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!used.has(`${MUSIC_DIR}/${name}`)) await rm(join(dir, name), { force: true });
    }
  }

  private enqueue(projectId: string, trackId: string, file: string): void {
    this.deps.queue.add(projectId, "music", `Preparing ${basename(file)}`, (ctx) => this.runPrep(projectId, trackId, ctx)).catch(() => {});
  }

  async runPrep(projectId: string, trackId: string, ctx: JobContext): Promise<void> {
    const track = (await this.deps.store.get(projectId)).music.find((t) => t.id === trackId);
    if (!track || track.prep) return; // removed while queued
    const rel = `${MUSIC_DIR}/${randomUUID().slice(0, 8)}.m4a`;
    const root = this.deps.store.dir(projectId);
    await mkdir(join(root, MUSIC_DIR), { recursive: true });
    await this.deps.prep(track.path, track.duration, join(root, rel), ctx);
    this.deps.changed(
      await this.deps.store.update(projectId, null, (p) => {
        const t = p.music.find((x) => x.id === trackId);
        if (t) t.prep = rel;
      }),
    );
  }
}
