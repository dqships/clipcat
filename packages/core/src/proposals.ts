// Turns the agent's answer into proposals the user can accept. The agent cites
// words by their index in the numbered transcript; nothing it says is trusted
// until it has been checked against the real words. Bad items come back as
// errors the agent is shown on its one retry.

import { z } from "zod";
import { wordSpanRange } from "./edits";
import { OVERLAY, defaultOverlay, overlayProposal } from "./overlays";
import { type Asset, OverlayPlacement, type Proposal, PunchStyle, type Range, SlideLook, type Source, type Word } from "./project";
import { PUNCH, punchProposal, punchRange } from "./punchins";
import { SLIDE, slideAsset } from "./slides";
import { SOUND, soundProposal } from "./sounds";

export const AgentProposal = z.object({
  type: z.enum(["retake", "cleanup", "tighten", "punch-in", "visual", "slide", "sound"]),
  from: z.number().int(),
  to: z.number().int(),
  keepFrom: z.number().int().nullable().optional(),
  keepTo: z.number().int().nullable().optional(),
  punchStyle: PunchStyle.nullable().optional(),
  /** For b-roll: the media's number in the list the agent was given, and how it covers the speaker. */
  media: z.number().int().nullable().optional(),
  placement: OverlayPlacement.nullable().optional(),
  /** For a motion slide: what it shows (the words on it, in order), and its look. */
  brief: z.string().max(1000).nullable().optional(),
  look: SlideLook.nullable().optional(),
  /** For a sound effect: its id in the library the agent was given. */
  sound: z.string().nullable().optional(),
  reason: z.string().min(1).max(400),
  confidence: z.number().min(0).max(1),
});

export const AgentAnalysis = z.object({
  proposals: z.array(AgentProposal).max(500),
  suggestedTitle: z.string().max(120).optional(),
});

export type AgentProposal = z.infer<typeof AgentProposal>;
export type AgentAnalysis = z.infer<typeof AgentAnalysis>;

/** `slides` are the new slide assets the kept slide proposals show, still to be designed. */
export type Validated = { proposals: Proposal[]; slides: Asset[]; errors: string[] };

/**
 * Checks each proposal against `words` (the numbered transcript, all sources
 * in order) and converts it into source-time cuts, or for a punch-in or
 * b-roll the range it covers. A slide is b-roll the AI editor designs, so it
 * comes with a new slide asset. Overlapping proposals keep the more confident
 * one; a punch-in only competes with other punch-ins, b-roll (slides
 * included) with other b-roll, and a sound effect with effects too close to
 * it, and none of them can sit on words a proposed cut removes. `assets` is
 * the media list the agent was given, numbered from 0, and `effects` the ids
 * of the sound effects it was offered.
 */
export function validateProposals(
  analysis: AgentAnalysis,
  words: Word[],
  sources: Pick<Source, "id" | "media">[],
  id: () => string,
  assets: Pick<Asset, "id">[] = [],
  effects: readonly string[] = [],
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
    if (p.type === "visual") {
      if (p.media == null || p.media < 0 || p.media >= assets.length) {
        errors.push(`${where}: b-roll must set media to a number from the media list${assets.length > 0 ? ` (0..${assets.length - 1})` : ", and there is no media"}`);
        return;
      }
      if (!p.placement) {
        errors.push(`${where}: b-roll must set placement`);
        return;
      }
      const length = words[p.to]!.end - words[p.from]!.start;
      if (length < OVERLAY.min || length > OVERLAY.max) {
        errors.push(`${where}: b-roll lasts ${OVERLAY.min} to ${OVERLAY.max} seconds; this one is ${length.toFixed(1)}`);
        return;
      }
    } else if (p.media != null || p.placement) {
      errors.push(`${where}: only b-roll may set media and placement`);
      return;
    }
    if (p.type === "slide") {
      if (!p.brief?.trim() || !p.look) {
        errors.push(`${where}: a slide must set brief and look`);
        return;
      }
      const length = words[p.to]!.end - words[p.from]!.start;
      if (length < SLIDE.min || length > SLIDE.max) {
        errors.push(`${where}: a slide lasts ${SLIDE.min} to ${SLIDE.max} seconds; this one is ${length.toFixed(1)}`);
        return;
      }
    } else if (p.brief || p.look) {
      errors.push(`${where}: only slides may set brief and look`);
      return;
    }
    if (p.type === "sound") {
      if (!p.sound || !effects.includes(p.sound)) {
        errors.push(`${where}: a sound must set sound to an id from the sound effects list${effects.length > 0 ? ` (${effects.join(", ")})` : ", and there are none"}`);
        return;
      }
      if (p.to !== p.from) {
        errors.push(`${where}: a sound lands on one word: set to the same as from`);
        return;
      }
    } else if (p.sound) {
      errors.push(`${where}: only sounds may set sound`);
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
  const taken = { cut: [] as [number, number][], punch: [] as [number, number][], visual: [] as [number, number][] };
  const sounds: Word[] = [];
  const proposals: Proposal[] = [];
  const slides: Asset[] = [];
  const cutIndices = new Set<number>();
  for (const { p, index } of candidates) {
    if (p.type === "sound") {
      const word = words[p.from]!;
      if (sounds.some((w) => w.sourceId === word.sourceId && Math.abs(w.start - word.start) < SOUND.gap)) {
        errors.push(`proposal ${index} (sound ${p.from}..${p.to}): within ${SOUND.gap} seconds of a more confident sound, dropped`);
        continue;
      }
      sounds.push(word);
      proposals.push(
        soundProposal(
          { id: id(), sourceId: word.sourceId, wordIds: [word.id], reason: p.reason, confidence: p.confidence, status: "pending" },
          { at: word.start, effect: p.sound!, volume: 0.7 },
        ),
      );
      continue;
    }
    const kind = p.type === "punch-in" ? taken.punch : p.type === "visual" || p.type === "slide" ? taken.visual : taken.cut;
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

    if (p.type === "visual") {
      const spoken = words.slice(p.from, p.to + 1);
      proposals.push(
        overlayProposal(
          { id: id(), sourceId, wordIds: spoken.map((w) => w.id), reason: p.reason, confidence: p.confidence, status: "pending" },
          defaultOverlay(punchRange(spoken), assets[p.media!]!.id, p.placement!),
        ),
      );
      continue;
    }

    if (p.type === "slide") {
      const spoken = words.slice(p.from, p.to + 1);
      const range = punchRange(spoken);
      const slide = slideAsset(id(), p.brief!, p.look!, range[1] - range[0]);
      slides.push(slide);
      proposals.push(
        overlayProposal(
          { id: id(), sourceId, wordIds: spoken.map((w) => w.id), reason: p.reason, confidence: p.confidence, status: "pending" },
          defaultOverlay(range, slide.id, "full"),
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
      overlay: null,
      sound: null,
    });
  }

  // A zoom or b-roll on words that are cut would never be seen.
  const cutIds = new Set([...cutIndices].map((i) => words[i]!.id));
  for (let k = proposals.length - 1; k >= 0; k--) {
    const x = proposals[k]!;
    if ((x.punch || x.overlay || x.sound) && x.wordIds.some((w) => cutIds.has(w))) {
      const index = words.findIndex((w) => w.id === x.wordIds[0]);
      errors.push(`${x.punch ? "punch-in" : x.sound ? "sound" : "b-roll"} at word ${index}: it sits on words another proposal cuts, dropped`);
      proposals.splice(k, 1);
      const dropped = slides.findIndex((a) => a.id === x.overlay?.assetId);
      if (dropped >= 0) slides.splice(dropped, 1);
    }
  }

  proposals.sort((x, y) => words.findIndex((w) => w.id === x.wordIds[0]) - words.findIndex((w) => w.id === y.wordIds[0]));
  return { proposals, slides, errors };
}

/** The proposal types the AI editor makes; silence comes from the meter. */
export const AI_TYPES: readonly Proposal["type"][] = ["retake", "cleanup", "tighten", "punch-in", "visual", "sound"];

export function cutsOverlap(a: Range[], b: Range[]): boolean {
  return a.some(([a0, a1]) => b.some(([b0, b1]) => a0 < b1 && b0 < a1));
}

/** The range a punch-in or b-roll covers; null for a cut. */
const covers = (p: Proposal): Range | null => p.punch?.range ?? p.overlay?.range ?? null;

/** Whether two proposals are about the same stretch: both cuts, both punch-ins or both b-roll over overlapping time, or two sounds close together. */
export function sameSpot(a: Proposal, b: Proposal): boolean {
  if (a.sourceId !== b.sourceId || !a.punch !== !b.punch || !a.overlay !== !b.overlay || !a.sound !== !b.sound) return false;
  if (a.sound && b.sound) return Math.abs(a.sound.at - b.sound.at) < SOUND.gap;
  const [ra, rb] = [covers(a), covers(b)];
  return ra && rb ? cutsOverlap([ra], [rb]) : cutsOverlap(a.cuts, b.cuts);
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
