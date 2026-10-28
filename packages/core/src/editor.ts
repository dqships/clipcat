// The edits a user makes in the transcript editor, as one schema-checked
// operation at a time: cut or restore words, accept or reject proposals, undo
// and redo. Each returns the next project; the store saves it with a
// revision check, so the UI and the agent can't overwrite each other.

import { z } from "zod";
import { type IdFactory, setRange, wordSpanRange } from "./edits";
import {
  AspectRatio,
  Captions,
  CaptionsPatch,
  type Project,
  type Proposal,
  OverlayPlacement,
  PipCorner,
  PipShape,
  ProposalStatus,
  PunchStyle,
  type Range,
  SlideLook,
  type Snapshot,
  type Word,
} from "./project";
import { defaultOverlay, overlayProposal } from "./overlays";
import { PUNCH_SCALE, punchProposal, punchRange } from "./punchins";
import { slideAsset, slideName } from "./slides";
import { soundProposal } from "./sounds";

export const EditOp = z.discriminatedUnion("type", [
  /** Cut (included: false) or restore (included: true) these words. */
  z.object({ type: z.literal("words"), wordIds: z.array(z.string()).min(1).max(100_000), included: z.boolean() }),
  /** Accept, reject, or put back to pending these proposals. */
  z.object({ type: z.literal("decide"), ids: z.array(z.string()).min(1).max(10_000), status: ProposalStatus }),
  /** Caption style. Not an undo step: it changes no cut, and the controls show it. */
  z.object({ type: z.literal("captions"), captions: CaptionsPatch }),
  /** Playback speed of the finished video. Not an undo step either, for the same reason. */
  z.object({ type: z.literal("speed"), speed: z.number().min(0.5).max(2) }),
  /** The shape the preview shows and the project is made for. Not an undo step. */
  z.object({ type: z.literal("aspect"), aspectRatio: AspectRatio }),
  /** Where a recording's speaker is (0..1 across), set by hand; null goes back to following the faces found. Not an undo step. */
  z.object({ type: z.literal("frame"), sourceId: z.string(), x: z.number().min(0).max(1).nullable() }),
  /** Punch in on these words (one recording's). An undo step, like accepting a suggested punch-in. */
  z.object({ type: z.literal("punch"), wordIds: z.array(z.string()).min(1).max(10_000), style: PunchStyle }),
  /** Another style for a punch-in. Not an undo step: the list shows it. */
  z.object({ type: z.literal("punch-style"), id: z.string(), style: PunchStyle }),
  /** Show b-roll over these words (one recording's). An undo step, like a punch-in. */
  z.object({ type: z.literal("overlay"), wordIds: z.array(z.string()).min(1).max(10_000), assetId: z.string(), placement: OverlayPlacement }),
  /** A motion slide over these words, for the AI editor to design from the brief. An undo step, like b-roll. */
  z.object({ type: z.literal("slide"), wordIds: z.array(z.string()).min(1).max(10_000), brief: z.string().trim().min(1).max(1000), look: SlideLook }),
  /** A sound effect from the library, landing on this word. An undo step, like a punch-in. */
  z.object({ type: z.literal("sound"), wordId: z.string(), effect: z.string().regex(/^[a-z0-9-]+$/) }),
  /** How loud an effect plays. Not an undo step: the list shows it. */
  z.object({ type: z.literal("sound-volume"), id: z.string(), volume: z.number().min(0).max(1) }),
  /** How loud the music plays, and whether it dips under speech. Not an undo step. */
  z.object({ type: z.literal("music"), volume: z.number().min(0).max(1).optional(), duck: z.boolean().optional() }),
  /** Takes the music out. Not an undo step. */
  z.object({ type: z.literal("remove-music") }),
  /** Where and how b-roll shows. Not an undo step: the list shows it. */
  z.object({
    type: z.literal("overlay-style"),
    id: z.string(),
    placement: OverlayPlacement.optional(),
    shape: PipShape.optional(),
    corner: PipCorner.optional(),
    size: z.number().min(0.2).max(0.6).optional(),
  }),
  /** What a picture or video shows, for the AI editor; for a slide, its brief, which has it designed again. Not an undo step. */
  z.object({ type: z.literal("describe"), assetId: z.string(), description: z.string().max(1000) }),
  /** Takes a picture or video out of the project, with the b-roll that used it. Not an undo step. */
  z.object({ type: z.literal("remove-asset"), assetId: z.string() }),
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
 * Applies `op` to a copy of `project` and returns it. Cuts and decisions
 * record an undo step, and so does a new punch-in or b-roll; caption style,
 * speed, shape, framing, punch-in and b-roll style, media, undo and redo don't. Unknown word or proposal ids are an error,
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

  if (op.type === "captions") {
    p.captions = Captions.parse({ ...p.captions, ...op.captions });
    return p;
  }

  if (op.type === "speed") {
    p.speed = op.speed;
    return p;
  }

  if (op.type === "aspect") {
    p.aspectRatio = op.aspectRatio;
    return p;
  }

  if (op.type === "frame") {
    const source = p.sources.find((s) => s.id === op.sourceId);
    if (!source) throw new Error(`Unknown source: ${op.sourceId}`);
    source.framing = op.x === null ? "auto" : "manual";
    if (op.x !== null) source.frameX = op.x;
    return p;
  }

  if (op.type === "punch-style") {
    const proposal = p.proposals.find((x) => x.id === op.id);
    if (!proposal?.punch) throw new Error(`Unknown punch-in: ${op.id}`);
    proposal.punch = { ...proposal.punch, style: op.style, scale: PUNCH_SCALE[op.style] };
    return p;
  }

  if (op.type === "overlay-style") {
    const proposal = p.proposals.find((x) => x.id === op.id);
    if (!proposal?.overlay) throw new Error(`Unknown b-roll: ${op.id}`);
    const { type: _, id: __, ...style } = op;
    proposal.overlay = { ...proposal.overlay, ...Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined)) };
    return p;
  }

  if (op.type === "sound-volume") {
    const proposal = p.proposals.find((x) => x.id === op.id);
    if (!proposal?.sound) throw new Error(`Unknown sound: ${op.id}`);
    proposal.sound = { ...proposal.sound, volume: op.volume };
    return p;
  }

  if (op.type === "music") {
    if (!p.music) throw new Error("There is no music");
    if (op.volume !== undefined) p.music.volume = op.volume;
    if (op.duck !== undefined) p.music.duck = op.duck;
    return p;
  }

  if (op.type === "remove-music") {
    p.music = null;
    return p;
  }

  if (op.type === "describe") {
    const asset = p.assets.find((a) => a.id === op.assetId);
    if (!asset) throw new Error(`Unknown media: ${op.assetId}`);
    asset.description = op.description.trim();
    if (asset.slide && asset.slide.brief !== asset.description && asset.description) {
      asset.slide = { ...asset.slide, brief: asset.description, html: "" };
      asset.name = slideName(asset.description);
      asset.prep = null;
    }
    return p;
  }

  if (op.type === "remove-asset") {
    if (!p.assets.some((a) => a.id === op.assetId)) throw new Error(`Unknown media: ${op.assetId}`);
    p.assets = p.assets.filter((a) => a.id !== op.assetId);
    p.proposals = p.proposals.filter((x) => x.overlay?.assetId !== op.assetId);
    return p;
  }

  // A new punch-in or b-roll joins as rejected before the undo step is taken, so undoing it takes it away again.
  let added: Proposal | null = null;
  if (op.type === "sound") {
    const word = p.transcript.find((w) => w.id === op.wordId);
    if (!word) throw new Error(`Unknown words: ${op.wordId}`);
    added = soundProposal(
      { id: id(), sourceId: word.sourceId, wordIds: [word.id], reason: "", confidence: 1, status: "rejected" },
      { at: word.start, effect: op.effect, volume: 0.7 },
    );
    p.proposals.push(added);
  }
  if (op.type === "punch" || op.type === "overlay" || op.type === "slide") {
    const ids = new Set(op.wordIds);
    const words = p.transcript.filter((w) => ids.has(w.id));
    if (words.length !== ids.size) throw new Error(`Unknown words: ${op.wordIds.filter((w) => !p.transcript.some((x) => x.id === w)).slice(0, 5).join(", ")}`);
    const sourceId = words[0]!.sourceId;
    const what = op.type === "punch" ? "A punch-in" : op.type === "slide" ? "A slide" : "B-roll";
    if (words.some((w) => w.sourceId !== sourceId)) throw new Error(`${what} stays inside one recording`);
    const fields = { id: id(), sourceId, wordIds: words.sort((a, b) => a.start - b.start).map((w) => w.id), reason: "", confidence: 1, status: "rejected" as const };
    if (op.type === "punch") {
      added = punchProposal(fields, punchRange(words), op.style);
    } else if (op.type === "slide") {
      const range = punchRange(words);
      const asset = slideAsset(id(), op.brief, op.look, range[1] - range[0]);
      p.assets.push(asset);
      added = overlayProposal(fields, defaultOverlay(range, asset.id, "full"));
    } else {
      if (!p.assets.some((a) => a.id === op.assetId)) throw new Error(`Unknown media: ${op.assetId}`);
      added = overlayProposal(fields, defaultOverlay(punchRange(words), op.assetId, op.placement));
    }
    p.proposals.push(added);
  }

  const before = snapshot(p);
  if (added) {
    added.status = "accepted";
  } else if (op.type === "words") {
    const known = new Set(p.transcript.map((w) => w.id));
    const missing = op.wordIds.filter((w) => !known.has(w));
    if (missing.length > 0) throw new Error(`Unknown words: ${missing.slice(0, 5).join(", ")}`);
    for (const { sourceId, range } of wordRanges(p, new Set(op.wordIds))) {
      p.segments = setRange(p.segments, sourceId, range, op.included, id);
    }
  } else if (op.type === "decide") {
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
