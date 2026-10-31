// B-roll media: probe each picture or video, add it to the project, then
// prepare it (a preview copy and a few frames, see media/assets.ts) on the
// project's queue and ask the AI editor what it shows. Each is saved as soon
// as it is prepared; `resume` prepares whatever an earlier run didn't.

import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { type Asset, type Project, heldByHistory } from "@clipcat/core";
import type { JobContext, JobQueue } from "../jobs/queue";
import type { AssetKind, AssetMedia } from "../media/assets";
import { VIDEO_FRAMES } from "../media/assets";
import type { ProjectStore } from "../store/projects";

export type AssetDeps = {
  store: ProjectStore;
  queue: JobQueue;
  probe: (file: string) => Promise<{ kind: AssetKind; media: AssetMedia }>;
  /** Writes the preview copy and the frames (absolute paths). */
  prep: (asset: Pick<Asset, "path" | "kind" | "media">, out: { preview: string; frames: string[] }, ctx: JobContext) => Promise<void>;
  /** Asks the AI editor to describe what nobody has yet; queued after the preparing. */
  describe: (projectId: string) => void;
  changed: (project: Project) => void;
};

/** An asset's folder and prepared files, relative to the project folder. */
export function assetPaths(asset: Pick<Asset, "id" | "kind">): { dir: string; preview: string; frames: string[] } {
  const dir = `media/assets/${asset.id}`;
  const count = asset.kind === "video" ? VIDEO_FRAMES : 1;
  return {
    dir,
    preview: `${dir}/preview.${asset.kind === "video" ? "mp4" : "png"}`,
    frames: Array.from({ length: count }, (_, i) => `${dir}/frame-${i + 1}.jpg`),
  };
}

const shortId = () => randomUUID().slice(0, 8);

export class AssetPipeline {
  constructor(private readonly deps: AssetDeps) {}

  /** Adds `files` to the project's media and queues preparing them. Every file is probed first, so a bad one adds nothing. */
  async add(projectId: string, files: string[]): Promise<Project> {
    const probed = await Promise.all(
      files.map(async (path) => {
        try {
          return { path, ...(await this.deps.probe(path)) };
        } catch (e) {
          throw new Error(`${basename(path)}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }),
    );
    const added: Asset[] = probed.map(({ path, kind, media }) => ({ id: `m${shortId()}`, name: basename(path), path, kind, media, prep: null, description: "", slide: null }));
    const project = await this.deps.store.update(projectId, null, (p) => {
      p.assets.push(...added);
    });
    await this.deps.store.log(projectId, { type: "media-added", files: probed.map((f) => f.path) });
    this.deps.changed(project);
    for (const a of added) this.enqueue(projectId, a);
    this.deps.describe(projectId);
    return project;
  }

  /** Prepares whatever an earlier run left unprepared, and describes what isn't described. */
  async resume(): Promise<void> {
    for (const summary of await this.deps.store.list()) {
      const p = await this.deps.store.get(summary.id);
      // A slide has nothing to prepare: the AI editor designs it (see AnalysisRunner.designMissing).
      const waiting = p.assets.filter((a) => !a.prep && a.kind !== "slide");
      for (const a of waiting) this.enqueue(p.id, a);
      if (waiting.length > 0) this.deps.describe(p.id);
      await this.sweep(p.id);
    }
  }

  /** Deletes the prepared files of media neither the project nor its undo history has any more. */
  async sweep(projectId: string): Promise<void> {
    const project = await this.deps.store.get(projectId);
    const held = heldByHistory(project.history).assets;
    const root = join(this.deps.store.dir(projectId), "media", "assets");
    for (const id of await readdir(root).catch(() => [] as string[])) {
      if (!held.has(id) && !project.assets.some((a) => a.id === id)) await this.forget(projectId, id);
    }
  }

  /** Deletes a removed asset's prepared files (the edit already took it out of the project). */
  async forget(projectId: string, assetId: string): Promise<void> {
    if (!/^[a-zA-Z0-9-]+$/.test(assetId)) return;
    await rm(join(this.deps.store.dir(projectId), "media", "assets", assetId), { recursive: true, force: true });
  }

  private enqueue(projectId: string, asset: Pick<Asset, "id" | "name">): void {
    this.deps.queue.add(projectId, "media", `Preparing ${asset.name}`, (ctx) => this.runPrep(projectId, asset.id, ctx)).catch(() => {});
  }

  async runPrep(projectId: string, assetId: string, ctx: JobContext): Promise<void> {
    const asset = (await this.deps.store.get(projectId)).assets.find((a) => a.id === assetId);
    if (!asset || asset.kind === "slide") return; // removed while queued
    const rel = assetPaths(asset);
    const root = this.deps.store.dir(projectId);
    await mkdir(join(root, rel.dir), { recursive: true });
    await this.deps.prep(asset, { preview: join(root, rel.preview), frames: rel.frames.map((f) => join(root, f)) }, ctx);
    this.deps.changed(
      await this.deps.store.update(projectId, null, (p) => {
        const a = p.assets.find((x) => x.id === assetId);
        if (a) a.prep = { preview: rel.preview, frames: rel.frames };
      }),
    );
  }
}
