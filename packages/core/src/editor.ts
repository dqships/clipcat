// The edits a user makes in the transcript editor, as one schema-checked
// operation at a time: cut or restore words, accept or reject proposals, undo
// and redo. Each returns the next project; the store saves it with a
// revision check, so the UI and the agent can't overwrite each other.

import { z } from "zod";
import { type IdFactory, setRange, wordSpanRange } from "./edits";
import { type Project, ProposalStatus, type Range, type Snapshot, type Word } from "./project";

export const EditOp = z.discriminatedUnion("type", [
  /** Cut (included: false) or restore (included: true) these words. */
  z.object({ type: z.literal("words"), wordIds: z.array(z.string()).min(1).max(100_000), included: z.boolean() }),
  /** Accept, reject, or put back to pending these proposals. */
  z.object({ type: z.literal("decide"), ids: z.array(z.string()).min(1).max(10_000), status: ProposalStatus }),
  z.object({ type: z.literal("undo") }),
  z.object({ type: z.literal("redo") }),
]);

export type EditOp = z.infer<typeof EditOp>;

/** Undo steps kept per project. */
export const HISTORY_LIMIT = 100;

function snapshot(p: Project): Snapshot {
  return { segments: structuredClone(p.segments), statuses: Object.fromEntries(p.proposals.map((x) => [x.id, x.status])) };
}

function restore(p: Project, s: Snapshot): void {
  p.segments = structuredClone(s.segments);
  // Proposals made since the snapshot keep their status; ones it knew get theirs back.
  for (const x of p.proposals) x.status = s.statuses[x.id] ?? x.status;
}

/** Runs of consecutive words (by index within each source), as source ranges to cut or restore. */
function wordRanges(project: Project, ids: Set<string>): { sourceId: string; range: Range }[] {
  const out: { sourceId: string; range: Range }[] = [];
  for (const source of project.sources) {
    const words: Word[] = project.transcript.filter((w) => w.sourceId === source.id).sort((a, b) => a.start - b.start);
    let start = -1;
    for (let i = 0; i <= words.length; i++) {
      const hit = i < words.length && ids.has(words[i]!.id);
      if (hit && start < 0) start = i;
      if (!hit && start >= 0) {
        out.push({ sourceId: source.id, range: wordSpanRange(words, start, i - 1, source.media.duration) });
        start = -1;
      }
    }
  }
  return out;
}

/**
 * Applies `op` to a copy of `project` and returns it. Every change but undo
 * and redo records an undo step. Unknown word or proposal ids are an error,
 * not a silent no-op, so a stale UI finds out.
 */
export function applyEdit(project: Project, op: EditOp, id: IdFactory): Project {
  const p = structuredClone(project);
  const history = p.history;

  if (op.type === "undo" || op.type === "redo") {
    const [from, to] = op.type === "undo" ? [history.past, history.future] : [history.future, history.past];
    const step = from.pop();
    if (!step) return p;
    to.push(snapshot(p));
    restore(p, step);
    return p;
  }

  const before = snapshot(p);
  if (op.type === "words") {
    const known = new Set(p.transcript.map((w) => w.id));
    const missing = op.wordIds.filter((w) => !known.has(w));
    if (missing.length > 0) throw new Error(`Unknown words: ${missing.slice(0, 5).join(", ")}`);
    for (const { sourceId, range } of wordRanges(p, new Set(op.wordIds))) {
      p.segments = setRange(p.segments, sourceId, range, op.included, id);
    }
  } else {
    const byId = new Map(p.proposals.map((x) => [x.id, x]));
    const missing = op.ids.filter((x) => !byId.has(x));
    if (missing.length > 0) throw new Error(`Unknown proposals: ${missing.slice(0, 5).join(", ")}`);
    for (const proposalId of op.ids) {
      const proposal = byId.get(proposalId)!;
      const was = proposal.status === "accepted";
      const now = op.status === "accepted";
      if (was !== now) {
        for (const cut of proposal.cuts) p.segments = setRange(p.segments, proposal.sourceId, cut, !now, id);
      }
      proposal.status = op.status;
    }
  }
  history.past.push(before);
  if (history.past.length > HISTORY_LIMIT) history.past.splice(0, history.past.length - HISTORY_LIMIT);
  history.future = [];
  return p;
}
