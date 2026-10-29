// The thumbnail: the user picks a moment, a job grabs that frame from the
// original recording and cuts its subject out, so the editor can put the
// text behind them. Only the current frame and cutout are kept.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { type Project, Thumbnail } from "@clipcat/core";
import type { JobContext, JobQueue } from "../jobs/queue";
import type { ProjectStore } from "../store/projects";

/** A cut-out subject (a PNG the size of the frame, transparent around them) and how much of the frame they cover. */
export type Cutout = { png: Buffer; coverage: number };

export type ThumbnailDeps = {
  store: ProjectStore;
  queue: JobQueue;
  /** Writes the frame at `time` seconds of `file` as a JPEG (an absolute path). */
  grab: (file: string, time: number, out: string, ctx: JobContext) => Promise<void>;
  /** Cuts the subject out of a picture; throws when the cutout can't run. */
  cutout: (picture: Buffer) => Promise<Cutout>;
  changed: (project: Project) => void;
};

export const THUMBNAIL_DIR = "media/thumbnail";
/** Less of the frame than this standing out means there's no subject to cut out. */
export const MIN_COVERAGE = 0.01;

export class ThumbnailPipeline {
  constructor(private readonly deps: ThumbnailDeps) {}

  /** Queues making the thumbnail from this moment of a recording, keeping the text and colours already set. */
  async pick(projectId: string, sourceId: string, time: number): Promise<void> {
    const source = (await this.deps.store.get(projectId)).sources.find((s) => s.id === sourceId);
    if (!source) throw new Error(`Unknown recording: ${sourceId}`);
    // The last frame can't be grabbed past; stay just inside it.
    const at = Math.min(Math.max(0, time), Math.max(0, source.media.duration - 0.05));
    this.deps.queue.add(projectId, "thumbnail", "Grabbing the thumbnail's frame", (ctx) => this.run(projectId, sourceId, at, ctx)).catch(() => {});
  }

  /** Deletes the pictures once the project no longer has a thumbnail. */
  async forget(projectId: string): Promise<void> {
    await rm(join(this.deps.store.dir(projectId), THUMBNAIL_DIR), { recursive: true, force: true });
  }

  async run(projectId: string, sourceId: string, time: number, ctx: JobContext): Promise<void> {
    const source = (await this.deps.store.get(projectId)).sources.find((s) => s.id === sourceId);
    if (!source) return; // removed while queued
    const root = this.deps.store.dir(projectId);
    const stamp = randomUUID().slice(0, 8);
    const frame = `${THUMBNAIL_DIR}/frame-${stamp}.jpg`;
    await mkdir(join(root, THUMBNAIL_DIR), { recursive: true });
    await this.deps.grab(source.path, time, join(root, frame), ctx);
    ctx.progress(null, "Cutting out the thumbnail's subject");
    // The frame shows at once; the subject follows when it's cut out.
    this.deps.changed(
      await this.deps.store.update(projectId, null, (p) => {
        const t = p.thumbnail;
        const style = t ? { text: t.text, textColor: t.textColor, background: t.background, textSide: t.textSide, textBox: t.textBox, behind: t.behind } : {};
        p.thumbnail = Thumbnail.parse({ ...style, sourceId, time, frame, subject: null });
      }),
    );
    await this.keepOnly(root, [frame]);

    const cut = await this.deps.cutout(await readFile(join(root, frame)));
    if (ctx.signal.aborted) throw new Error("cancelled");
    const subject = cut.coverage >= MIN_COVERAGE ? `${THUMBNAIL_DIR}/subject-${stamp}.png` : null;
    if (subject) await writeFile(join(root, subject), cut.png);
    const project = await this.deps.store.update(projectId, null, (p) => {
      if (p.thumbnail?.frame === frame) p.thumbnail.subject = subject;
    });
    await this.deps.store.log(projectId, { type: "thumbnail", sourceId, time, subject: subject !== null, coverage: cut.coverage });
    this.deps.changed(project);
    if (project.thumbnail?.frame !== frame) await this.keepOnly(root, [project.thumbnail?.frame, project.thumbnail?.subject]);
  }

  /** Deletes the thumbnail pictures other than these. */
  private async keepOnly(root: string, keep: (string | null | undefined)[]): Promise<void> {
    const names = new Set(keep.filter((k): k is string => !!k).map((k) => basename(k)));
    const dir = join(root, THUMBNAIL_DIR);
    for (const name of await readdir(dir).catch(() => [])) if (!names.has(name)) await rm(join(dir, name), { force: true });
  }
}
