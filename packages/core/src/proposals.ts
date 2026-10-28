// Turns the agent's answer into proposals the user can accept. The agent cites
// words by their index in the numbered transcript; nothing it says is trusted
// until it has been checked against the real words. Bad items come back as
// errors the agent is shown on its one retry.

import { z } from "zod";
import { wordSpanRange } from "./edits";
import { type Proposal, PunchStyle, type Range, type Source, type Word } from "./project";
import { PUNCH, punchProposal, punchRange } from "./punchins";

export const AgentProposal = z.object({
  type: z.enum(["retake", "cleanup", "tighten", "punch-in"]),
  from: z.number().int(),
  to: z.number().int(),
  keepFrom: z.number().int().nullable().optional(),
  keepTo: z.number().int().nullable().optional(),
  punchStyle: PunchStyle.nullable().optional(),
  reason: z.string().min(1).max(400),
  confidence: z.number().min(0).max(1),
});

export const AgentAnalysis = z.object({
  proposals: z.array(AgentProposal).max(500),
  suggestedTitle: z.string().max(120).optional(),
});

export type AgentProposal = z.infer<typeof AgentProposal>;
export type AgentAnalysis = z.infer<typeof AgentAnalysis>;

export type Validated = { proposals: Proposal[]; errors: string[] };

/**
 * Checks each proposal against `words` (the numbered transcript, all sources
 * in order) and converts it into source-time cuts, or for a punch-in the
 * range to zoom over. Overlapping proposals keep the more confident one; a
 * punch-in only competes with other punch-ins, and can't sit on words a
 * proposed cut removes.
 */
export function validateProposals(
  analysis: AgentAnalysis,
  words: Word[],
  sources: Pick<Source, "id" | "media">[],
  id: () => string,
): Validated {
  const errors: string[] = [];
  const durations = new Map(sources.map((s) => [s.id, s.media.duration]));
  const candidates: { p: AgentProposal; index: number }[] = [];

  analysis.proposals.forEach((p, index) => {
    const where = `proposal ${index} (${p.type} ${p.from}..${p.to})`;
    if (p.from < 0 || p.to >= words.length || p.from > p.to) {
      errors.push(`${where}: word indices must satisfy 0 <= from <= to < ${words.length}`);
      return;
    }
    if (words[p.from]!.sourceId !== words[p.to]!.sourceId) {
      errors.push(`${where}: a proposal must stay inside one recording`);
      return;
    }
    const hasKeep = p.keepFrom != null || p.keepTo != null;
    if (p.type !== "retake" && hasKeep) {
      errors.push(`${where}: only retakes may set keepFrom/keepTo`);
      return;
    }
    if (p.type === "punch-in") {
      if (!p.punchStyle) {
        errors.push(`${where}: a punch-in must set punchStyle`);
        return;
      }
      const length = words[p.to]!.end - words[p.from]!.start;
      if (length < PUNCH.min || length > PUNCH.max) {
        errors.push(`${where}: a punch-in lasts ${PUNCH.min} to ${PUNCH.max} seconds; this one is ${length.toFixed(1)}`);
        return;
      }
    } else if (p.punchStyle) {
      errors.push(`${where}: only punch-ins may set punchStyle`);
      return;
    }
    if (p.type === "retake") {
      if (p.keepFrom == null || p.keepTo == null) {
        errors.push(`${where}: a retake must set both keepFrom and keepTo`);
        return;
      }
      if (!(p.from <= p.keepFrom && p.keepFrom <= p.keepTo && p.keepTo <= p.to)) {
        errors.push(`${where}: keepFrom..keepTo must sit inside from..to`);
        return;
      }
      if (p.keepFrom === p.from && p.keepTo === p.to) {
        errors.push(`${where}: a retake that keeps everything cuts nothing`);
        return;
      }
    }
    candidates.push({ p, index });
  });

  // Most confident first; anything overlapping an already kept proposal of its kind is dropped.
  candidates.sort((x, y) => y.p.confidence - x.p.confidence || x.index - y.index);
  const taken = { cut: [] as [number, number][], punch: [] as [number, number][] };
  const proposals: Proposal[] = [];
  const cutIndices = new Set<number>();
  for (const { p, index } of candidates) {
    const kind = p.type === "punch-in" ? taken.punch : taken.cut;
    if (kind.some(([a, b]) => p.from <= b && a <= p.to)) {
      errors.push(`proposal ${index} (${p.type} ${p.from}..${p.to}): overlaps a more confident proposal, dropped`);
      continue;
    }
    kind.push([p.from, p.to]);

    const sourceId = words[p.from]!.sourceId;
    const local = words.filter((w) => w.sourceId === sourceId);
    const offset = words.indexOf(local[0]!);
    const duration = durations.get(sourceId) ?? local[local.length - 1]!.end;
    const span = (from: number, to: number): Range => wordSpanRange(local, from - offset, to - offset, duration);

    if (p.type === "punch-in") {
      const spoken = words.slice(p.from, p.to + 1);
      proposals.push(
        punchProposal(
          { id: id(), sourceId, wordIds: spoken.map((w) => w.id), reason: p.reason, confidence: p.confidence, status: "pending" },
          punchRange(spoken),
          p.punchStyle!,
        ),
      );
      continue;
    }

    const cuts: Range[] = [];
    const cutWords: string[] = [];
    if (p.type === "retake") {
      if (p.keepFrom! > p.from) cuts.push(span(p.from, p.keepFrom! - 1));
      if (p.keepTo! < p.to) cuts.push(span(p.keepTo! + 1, p.to));
      for (let i = p.from; i <= p.to; i++) if (i < p.keepFrom! || i > p.keepTo!) cutWords.push(words[i]!.id), cutIndices.add(i);
    } else {
      cuts.push(span(p.from, p.to));
      for (let i = p.from; i <= p.to; i++) cutWords.push(words[i]!.id), cutIndices.add(i);
    }

    proposals.push({
      id: id(),
      type: p.type,
      sourceId,
      cuts,
      wordIds: cutWords,
      keepWordIds: p.type === "retake" ? words.slice(p.keepFrom!, p.keepTo! + 1).map((w) => w.id) : [],
      reason: p.reason,
      confidence: p.confidence,
      status: "pending",
      punch: null,
    });
  }

  // A zoom on words that are cut would never be seen.
  const cutIds = new Set([...cutIndices].map((i) => words[i]!.id));
  for (let k = proposals.length - 1; k >= 0; k--) {
    const x = proposals[k]!;
    if (x.punch && x.wordIds.some((w) => cutIds.has(w))) {
      const index = words.findIndex((w) => w.id === x.wordIds[0]);
      errors.push(`punch-in at word ${index}: it sits on words another proposal cuts, dropped`);
      proposals.splice(k, 1);
    }
  }

  proposals.sort((x, y) => words.findIndex((w) => w.id === x.wordIds[0]) - words.findIndex((w) => w.id === y.wordIds[0]));
  return { proposals, errors };
}

/** The proposal types the AI editor makes; silence comes from the meter. */
export const AI_TYPES: readonly Proposal["type"][] = ["retake", "cleanup", "tighten", "punch-in"];

export function cutsOverlap(a: Range[], b: Range[]): boolean {
  return a.some(([a0, a1]) => b.some(([b0, b1]) => a0 < b1 && b0 < a1));
}

/** Whether two proposals are about the same stretch: both cuts, or both punch-ins, over overlapping time. */
export function sameSpot(a: Proposal, b: Proposal): boolean {
  if (a.sourceId !== b.sourceId || !a.punch !== !b.punch) return false;
  return a.punch && b.punch ? cutsOverlap([a.punch.range], [b.punch.range]) : cutsOverlap(a.cuts, b.cuts);
}

/**
 * Fresh proposals replace the pending ones `replaces` picks out. Ones the user
 * already accepted or rejected stay, and a fresh one that overlaps any of them
 * is dropped, so a rerun never asks the same question twice.
 */
export function replacePending(current: Proposal[], fresh: Proposal[], replaces: (p: Proposal) => boolean): Proposal[] {
  const kept = current.filter((p) => !(replaces(p) && p.status === "pending"));
  const decided = kept.filter((p) => replaces(p) && p.status !== "pending");
  return [...kept, ...fresh.filter((f) => !decided.some((d) => sameSpot(d, f)))];
}
