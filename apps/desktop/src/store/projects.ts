// Projects on disk: <root>/<id>/project.json plus the prepared media beside
// it. Every save names the revision it was based on; a save from a stale copy
// is refused, so the UI, the agent and later the external MCP can't overwrite
// each other's edits.

import { randomUUID } from "node:crypto";
import { appendFile, copyFile, link, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Project } from "@clipcat/core";
import { writeFileAtomic } from "../atomic";

export class RevisionConflict extends Error {
  constructor(
    readonly current: number,
    readonly based: number,
  ) {
    super(`The project changed since revision ${based} (now ${current}). Reload and try again.`);
  }
}

export type ProjectSummary = {
  id: string;
  name: string;
  updatedAt: string;
  duration: number;
  sources: number;
  /** First thumbnail of the first prepared source, relative to the project folder. */
  thumb: string | null;
  /** For a short, the name of the project it was cut from. */
  origin: string | null;
};

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

export class ProjectStore {
  /** Saves for the same project run one after another, so revision checks can't race. */
  private chains = new Map<string, Promise<unknown>>();

  constructor(readonly root: string) {}

  dir(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error(`Bad project id: ${id}`);
    return join(this.root, id);
  }

  mediaDir(id: string, sourceId: string): string {
    if (!SAFE_ID.test(sourceId)) throw new Error(`Bad source id: ${sourceId}`);
    return join(this.dir(id), "media", sourceId);
  }

  async list(): Promise<ProjectSummary[]> {
    await mkdir(this.root, { recursive: true });
    const out: ProjectSummary[] = [];
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !SAFE_ID.test(entry.name)) continue;
      try {
        const p = await this.get(entry.name);
        out.push({
          id: p.id,
          name: p.name,
          updatedAt: p.updatedAt,
          duration: p.sources.reduce((n, s) => n + s.media.duration, 0),
          sources: p.sources.length,
          thumb: p.sources.find((s) => s.prep)?.prep?.thumbs.replace("%04d", "0001") ?? null,
          origin: p.origin?.name ?? null,
        });
      } catch {
        // A half-written or foreign folder: skip it rather than hide the rest.
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Project> {
    return Project.parse(JSON.parse(await readFile(join(this.dir(id), "project.json"), "utf8")));
  }

  async create(name: string): Promise<Project> {
    const now = new Date().toISOString();
    const project = Project.parse({
      version: 1,
      id: randomUUID(),
      name,
      revision: 0,
      sources: [],
      transcript: [],
      segments: [],
      proposals: [],
      captions: {},
      createdAt: now,
      updatedAt: now,
    });
    await mkdir(this.dir(project.id), { recursive: true });
    await writeFileAtomic(join(this.dir(project.id), "project.json"), JSON.stringify(project, null, 2));
    await this.log(project.id, { type: "created", name });
    return project;
  }

  /**
   * Saves `project` as a new project whose sources' prepared media come from
   * project `from`: hard links, so a short costs no disk space (copies where
   * the disk can't link).
   */
  async createFrom(project: Project, from: string): Promise<Project> {
    const parsed = Project.parse(project);
    if (parsed.id === from) throw new Error("A project can't be made from itself");
    try {
      for (const s of parsed.sources) await linkTree(this.mediaDir(from, s.id), this.mediaDir(parsed.id, s.id));
      await writeFileAtomic(join(this.dir(parsed.id), "project.json"), JSON.stringify(parsed, null, 2));
    } catch (e) {
      await rm(this.dir(parsed.id), { recursive: true, force: true });
      throw e;
    }
    await this.log(parsed.id, { type: "created", name: parsed.name, from });
    return parsed;
  }

  /**
   * Applies `change` to the latest saved project, if it is still at `based`
   * (or always, when `based` is null: main-process jobs that only add to it).
   */
  update(id: string, based: number | null, change: (p: Project) => Project | void): Promise<Project> {
    const run = async () => {
      const current = await this.get(id);
      if (based !== null && current.revision !== based) throw new RevisionConflict(current.revision, based);
      const draft = structuredClone(current);
      const next = Project.parse(change(draft) ?? draft);
      next.revision = current.revision + 1;
      next.updatedAt = new Date().toISOString();
      await writeFileAtomic(join(this.dir(id), "project.json"), JSON.stringify(next, null, 2));
      return next;
    };
    const chained = (this.chains.get(id) ?? Promise.resolve()).then(run, run);
    this.chains.set(
      id,
      chained.catch(() => {}),
    );
    return chained;
  }

  async remove(id: string): Promise<void> {
    await rm(this.dir(id), { recursive: true, force: true });
  }

  /** Appends one event to the project's log. Never throws: the log is for diagnosis only. */
  async log(id: string, event: Record<string, unknown>): Promise<void> {
    const line = JSON.stringify({ at: new Date().toISOString(), ...event });
    await appendFile(join(this.dir(id), "events.jsonl"), `${line}\n`, { mode: 0o600 }).catch(() => {});
  }
}

/** Mirrors the files under `from` into `to` as hard links, or copies when linking fails (another disk, FAT). */
async function linkTree(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true }).catch(() => [])) {
    const a = join(from, entry.name);
    const b = join(to, entry.name);
    if (entry.isDirectory()) await linkTree(a, b);
    else if (entry.isFile()) await link(a, b).catch(() => copyFile(a, b));
  }
}
