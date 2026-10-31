// What an undo step keeps of a change outside the cuts: only the values the
// change replaced, field by field, so the history stays small however long
// the transcript is, and a job that finished in between (a prepared clip, a
// new thumbnail frame) isn't taken back with it. Applying a change gives the
// change that reverses it, which is what redo keeps.

import { z } from "zod";
import type { History, Project } from "./project";

/** Lists whose items a change can edit, take out or bring back, found by id. */
const LISTS = ["transcript", "proposals", "assets", "music", "sources"] as const;
/** Objects whose fields a change sets. */
const OBJECTS = ["captions", "writeup", "thumbnail"] as const;
/** Values a change replaces whole. */
const VALUES = ["speed", "aspectRatio", "bars"] as const;

export type Tracked = (typeof LISTS)[number] | (typeof OBJECTS)[number] | (typeof VALUES)[number];

type Item = { id: string } & Record<string, unknown>;
type Fields = Record<string, unknown>;

const ListChange = z.object({
  /** The earlier values of the fields changed, by item id. */
  fields: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  /** Items to bring back. */
  put: z.array(z.looseObject({ id: z.string() })).default([]),
  /** Ids of items to take out. */
  drop: z.array(z.string()).default([]),
  /** The ids in order, when items come or go. */
  order: z.array(z.string()).nullable().default(null),
});

export const Change = z.object({
  lists: z.record(z.string(), ListChange).default({}),
  /** The earlier values of the fields changed in each object. */
  objects: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  /** Whole earlier values. An object that was or became null counts as one. */
  values: z.record(z.string(), z.unknown()).default({}),
});
export type Change = z.infer<typeof Change>;
type ListChange = z.infer<typeof ListChange>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Stands for a field that wasn't set, which JSON can't keep and null wouldn't mean. */
const UNSET = "\u0000unset";

const earlier = (target: Fields, keys: string[]): Fields => Object.fromEntries(keys.map((k) => [k, target[k] === undefined ? UNSET : target[k]]));

function setFields(target: Fields, fields: Fields): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value === UNSET) delete target[key];
    else target[key] = value;
  }
}

/** The fields of `before` that differ in `after`. */
function changedFields(before: Fields, after: Fields): Fields | null {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !same(before[k], after[k]));
  return keys.length > 0 ? earlier(before, keys) : null;
}

function listDiff(before: Item[], after: Item[]): ListChange | null {
  const now = new Map(after.map((x) => [x.id, x]));
  const was = new Map(before.map((x) => [x.id, x]));
  const change: ListChange = { fields: {}, put: before.filter((x) => !now.has(x.id)), drop: after.filter((x) => !was.has(x.id)).map((x) => x.id), order: null };
  for (const item of before) {
    const next = now.get(item.id);
    const fields = next && changedFields(item, next);
    if (fields) change.fields[item.id] = fields;
  }
  if (change.put.length > 0 || change.drop.length > 0) change.order = before.map((x) => x.id);
  return change.order || Object.keys(change.fields).length > 0 ? change : null;
}

/** What it takes to get `before` back from `after`, looking only at `keys`; null if they match there. */
export function diffProject(before: Project, after: Project, keys: Tracked[]): Change | null {
  const change: Change = { lists: {}, objects: {}, values: {} };
  for (const key of keys) {
    if ((LISTS as readonly string[]).includes(key)) {
      const list = listDiff(before[key as (typeof LISTS)[number]] as unknown as Item[], after[key as (typeof LISTS)[number]] as unknown as Item[]);
      if (list) change.lists[key] = list;
    } else {
      const was = before[key as keyof Project] as unknown;
      const now = after[key as keyof Project] as unknown;
      const objects = (OBJECTS as readonly string[]).includes(key) && was && now;
      const fields = objects ? changedFields(was as Fields, now as Fields) : null;
      if (fields) change.objects[key] = fields;
      else if (!objects && !same(was, now)) change.values[key] = was;
    }
  }
  return Object.keys(change.lists).length + Object.keys(change.objects).length + Object.keys(change.values).length > 0 ? change : null;
}

/** Applies `change` to `list` in place, skipping what has gone since, and gives the change that reverses it. */
function applyList(list: Item[], change: ListChange): ListChange {
  const back: ListChange = { fields: {}, put: [], drop: [], order: change.order ? list.map((x) => x.id) : null };
  const byId = new Map(list.map((x) => [x.id, x]));
  for (const [id, fields] of Object.entries(change.fields)) {
    const item = byId.get(id);
    if (!item) continue;
    back.fields[id] = earlier(item, Object.keys(fields));
    setFields(item, fields);
  }
  for (const id of change.drop) {
    const at = list.findIndex((x) => x.id === id);
    if (at >= 0) back.put.push(...(list.splice(at, 1) as Item[]));
  }
  for (const item of change.put as Item[]) {
    if (byId.has(item.id)) continue;
    list.push(item);
    back.drop.push(item.id);
  }
  if (change.order) {
    const rank = new Map(change.order.map((id, i) => [id, i]));
    list.sort((a, b) => (rank.get(a.id) ?? rank.size) - (rank.get(b.id) ?? rank.size));
  }
  return back;
}

/** Applies `change` to `p` in place and gives the change that reverses it. */
export function applyChange(p: Project, change: Change): Change {
  const back: Change = { lists: {}, objects: {}, values: {} };
  const project = p as unknown as Record<string, unknown>;
  for (const [key, list] of Object.entries(change.lists)) back.lists[key] = applyList(project[key] as Item[], list);
  for (const [key, fields] of Object.entries(change.objects)) {
    const target = project[key] as Fields | null;
    if (!target) continue;
    back.objects[key] = earlier(target, Object.keys(fields));
    setFields(target, fields);
  }
  for (const [key, value] of Object.entries(change.values)) {
    back.values[key] = project[key];
    project[key] = value;
  }
  return back;
}

/**
 * What undo or redo could still bring back: the ids of removed media and the
 * prepared copies of removed music, whose files have to stay on disk until
 * they fall out of the history.
 */
export function heldByHistory(history: History): { assets: Set<string>; music: Set<string> } {
  const steps = [...history.past, ...history.future].flatMap((s) => (s.change ? [s.change] : []));
  const put = (list: string) => steps.flatMap((c) => c.lists[list]?.put ?? []) as Item[];
  return {
    assets: new Set(put("assets").map((a) => a.id)),
    music: new Set(put("music").flatMap((t) => (typeof t.prep === "string" ? [t.prep] : []))),
  };
}
