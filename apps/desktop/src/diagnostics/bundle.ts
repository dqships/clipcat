// The diagnostics bundle: one zip with what's needed to see why something went
// wrong, and nothing from the videos themselves. It holds the app's versions
// and setup, the main log, recent jobs, each project's event log and its shape
// (sources, counts, settings) without the transcript, and the latest crash
// dumps. Every part is read on its own, so a broken project or a missing log
// leaves a note in the bundle instead of stopping it.

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { strToU8, zipSync, type Zippable } from "fflate";

export type BundleInput = {
  /** Versions, platform, tools, settings: assembled by the caller, already free of secrets. */
  about: Record<string, unknown>;
  logs: string[];
  jobs: unknown;
  projectsDir: string;
  /** Where crash dumps are written; null when crash reporting is off. */
  crashDir: string | null;
  /** Replaced by ~ in every text file, so the bundle doesn't carry the user's name around. */
  home: string;
};

/** Project events kept per project, newest last. */
const EVENT_LINES = 500;
/** Crash dumps kept, newest first, and how large they may be together. */
const DUMPS = 3;
const DUMP_BYTES = 30 * 1024 * 1024;

/** A project's shape: everything that explains a failure, nothing that is the user's words. */
export function projectShape(project: Record<string, unknown>): Record<string, unknown> {
  const list = (key: string) => (Array.isArray(project[key]) ? (project[key] as unknown[]) : []);
  const sources = list("sources").map((s) => {
    const { id, name, order, media, prep, transcription, frameX } = s as Record<string, unknown>;
    return { id, name, order, media, prep, transcription, frameX };
  });
  const proposals = list("proposals") as { type?: string; status?: string }[];
  const counted: Record<string, number> = {};
  for (const p of proposals) counted[`${p.type}:${p.status}`] = (counted[`${p.type}:${p.status}`] ?? 0) + 1;
  return {
    id: project.id,
    version: project.version,
    revision: project.revision,
    language: project.language,
    aspectRatio: project.aspectRatio,
    speed: project.speed,
    origin: project.origin,
    sources,
    words: list("transcript").length,
    segments: list("segments").length,
    assets: list("assets").length,
    proposals: counted,
    captions: project.captions,
    lastExport: project.lastExport,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export async function diagnosticsZip(input: BundleInput): Promise<Uint8Array> {
  const files: Zippable = {};
  const problems: string[] = [];
  const scrub = (text: string) => (input.home ? text.split(input.home).join("~") : text);
  const text = (name: string, value: string) => {
    files[name] = strToU8(scrub(value));
  };
  const json = (name: string, value: unknown) => text(name, `${JSON.stringify(value, null, 2)}\n`);
  const attempt = async (what: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (e) {
      problems.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  for (const log of input.logs) {
    await attempt(log, async () => text(`logs/${log.split(/[\\/]/).at(-1)}`, await readFile(log, "utf8")));
  }
  json("jobs.json", input.jobs);

  const ids = await readdir(input.projectsDir).catch(() => [] as string[]);
  for (const id of ids.filter((n) => /^[a-zA-Z0-9-]+$/.test(n))) {
    const dir = join(input.projectsDir, id);
    await attempt(`project ${id}`, async () => json(`projects/${id}/shape.json`, projectShape(JSON.parse(await readFile(join(dir, "project.json"), "utf8")))));
    await attempt(`project ${id} events`, async () => {
      const lines = (await readFile(join(dir, "events.jsonl"), "utf8")).trimEnd().split("\n");
      text(`projects/${id}/events.jsonl`, `${lines.slice(-EVENT_LINES).join("\n")}\n`);
    });
  }

  if (input.crashDir) {
    await attempt("crash dumps", async () => {
      const dumps = await findDumps(input.crashDir!);
      let total = 0;
      for (const dump of dumps.slice(0, DUMPS)) {
        if (total + dump.size > DUMP_BYTES) break;
        total += dump.size;
        files[`crashes/${dump.name}`] = new Uint8Array(await readFile(dump.path));
      }
      json("crashes/list.json", dumps.map(({ name, size, at }) => ({ name, size, at })));
    });
  }

  json("about.json", { ...input.about, problems });
  return zipSync(files, { level: 6 });
}

/** Minidumps anywhere under the crash folder, newest first. */
async function findDumps(root: string): Promise<{ path: string; name: string; size: number; at: string }[]> {
  const found: { path: string; name: string; size: number; at: string; ms: number }[] = [];
  const walk = async (dir: string, depth: number) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && depth < 3) await walk(path, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".dmp")) {
        const s = await stat(path);
        found.push({ path, name: entry.name, size: s.size, at: s.mtime.toISOString(), ms: s.mtimeMs });
      }
    }
  };
  await walk(root, 0);
  return found.sort((a, b) => b.ms - a.ms).map(({ path, name, size, at }) => ({ path, name, size, at }));
}
