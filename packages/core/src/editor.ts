// The edits a user makes in the transcript editor, as one schema-checked
// operation at a time: cut or restore words, accept or reject proposals, undo
// and redo. Each returns the next project; the store saves it with a
// revision check, so the UI and the agent can't overwrite each other.

import { z } from "zod";
import { respell } from "./corrections";
import { type IdFactory, setRange, wordSpanRange } from "./edits";
import { type Tracked, applyChange, diffProject } from "./history";
import {
  AspectRatio,
  Bars,
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
  ThumbnailBackground,
  ThumbnailBox,
  ThumbnailColor,
  type Word,
  Writeup,
} from "./project";
import { defaultOverlay, overlayProposal } from "./overlays";
import { PUNCH_SCALE, punchProposal, punchRange } from "./punchins";
import { CHAPTERS } from "./writeup";
import { slideAsset, slideName } from "./slides";
import { musicProposal, soundProposal } from "./sounds";

export const EditOp = z.discriminatedUnion("type", [
  /** Cut (included: false) or restore (included: true) these words. */
  z.object({ type: z.literal("words"), wordIds: z.array(z.string()).min(1).max(100_000), included: z.boolean() }),
  /** Accept, reject, or put back to pending these proposals. */
  z.object({ type: z.literal("decide"), ids: z.array(z.string()).min(1).max(10_000), status: ProposalStatus }),
  /** Caption style. */
  z.object({ type: z.literal("captions"), captions: CaptionsPatch }),
  /** Playback speed of the finished video. */
  z.object({ type: z.literal("speed"), speed: z.number().min(0.5).max(2) }),
  /** The shape the preview shows and the project is made for. */
  z.object({ type: z.literal("aspect"), aspectRatio: AspectRatio }),
  /** What fills the sides of a recording that doesn't fill a wide video. */
  z.object({ type: z.literal("bars"), bars: Bars }),
  /** Where a recording's speaker is (0..1 across), set by hand; null goes back to following the faces found. */
  z.object({ type: z.literal("frame"), sourceId: z.string(), x: z.number().min(0).max(1).nullable() }),
  /** Punch in on these words (one recording's). */
  z.object({ type: z.literal("punch"), wordIds: z.array(z.string()).min(1).max(10_000), style: PunchStyle }),
  /** Another style for a punch-in. */
  z.object({ type: z.literal("punch-style"), id: z.string(), style: PunchStyle }),
  /** Show b-roll over these words (one recording's). */
  z.object({ type: z.literal("overlay"), wordIds: z.array(z.string()).min(1).max(10_000), assetId: z.string(), placement: OverlayPlacement }),
  /** A motion slide over these words, for the AI editor to design from the brief. */
  z.object({ type: z.literal("slide"), wordIds: z.array(z.string()).min(1).max(10_000), brief: z.string().trim().min(1).max(1000), look: SlideLook }),
  /** A sound effect from the library, landing on this word. */
  z.object({ type: z.literal("sound"), wordId: z.string(), effect: z.string().regex(/^[a-z0-9-]+$/) }),
  /** How loud an effect plays. */
  z.object({ type: z.literal("sound-volume"), id: z.string(), volume: z.number().min(0).max(1) }),
  /**
   * A music track's settings: how loud it plays, whether it dips under speech, what it sounds like and
   * whether it plays under the whole video. `id` can be left out when there is only one.
   */
  z.object({
    type: z.literal("music"),
    id: z.string().optional(),
    volume: z.number().min(0).max(1).optional(),
    duck: z.boolean().optional(),
    description: z.string().max(1000).optional(),
    whole: z.boolean().optional(),
  }),
  /** Takes a music track out, with its placements. `id` can be left out when there is only one. */
  z.object({ type: z.literal("remove-music"), id: z.string().optional() }),
  /** Plays a music track over these words (one recording's). */
  z.object({ type: z.literal("place-music"), wordIds: z.array(z.string()).min(1).max(10_000), trackId: z.string() }),
  /** Retypes a word speech recognition got wrong. Its timing and the cuts stay; captions, the write-up and the AI editor read the new text. */
  z.object({
    type: z.literal("fix-word"),
    wordId: z.string(),
    text: z.string().trim().min(1).max(60).regex(/^\S+$/, "Type one word, without spaces"),
  }),
  /** Starts a chapter on this word with this title, or renames the one there. */
  z.object({ type: z.literal("chapter"), wordId: z.string(), title: z.string().trim().min(1).max(100) }),
  /** Takes out the chapter that starts on this word. */
  z.object({ type: z.literal("remove-chapter"), wordId: z.string() }),
  /** Changes the description or the article. */
  z.object({
    type: z.literal("writeup"),
    description: z.string().max(5000).optional(),
    articleTitle: z.string().max(200).optional(),
    article: z.string().max(100_000).optional(),
  }),
  /** The thumbnail's text and colours. */
  z.object({
    type: z.literal("thumbnail"),
    text: z.string().max(80).optional(),
    textColor: ThumbnailColor.optional(),
    background: ThumbnailBackground.optional(),
    textSide: z.enum(["left", "right"]).optional(),
    /** Where the text goes; null puts it back in its half. */
    textBox: ThumbnailBox.nullable().optional(),
    behind: z.boolean().optional(),
  }),
  /** Where and how b-roll shows. */
  z.object({
    type: z.literal("overlay-style"),
    id: z.string(),
    placement: OverlayPlacement.optional(),
    shape: PipShape.optional(),
    corner: PipCorner.optional(),
    size: z.number().min(0.2).max(0.6).optional(),
  }),
  /** What a picture or video shows, for the AI editor; for a slide, its brief, which has it designed again. */
  z.object({ type: z.literal("describe"), assetId: z.string(), description: z.string().max(1000) }),
  /** Takes a picture or video out of the project, with the b-roll that used it. */
  z.object({ type: z.literal("remove-asset"), assetId: z.string() }),
  z.object({ type: z.literal("undo") }),
  z.object({ type: z.literal("redo") }),
]);

export type EditOp = z.infer<typeof EditOp>;

/** Undo steps kept per project. */
export const HISTORY_LIMIT = 100;
/** Changes from one control this close together are one undo step, so a drag is one step however many edits it sends. */
export const SAME_STEP_MS = 1000;

/** What each change outside the cuts can touch; the rest make their undo step in `change`. */
const TOUCHES: Partial<Record<EditOp["type"], Tracked[]>> = {
  captions: ["captions"],
  speed: ["speed"],
  aspect: ["aspectRatio"],
  bars: ["bars"],
  frame: ["sources"],
  "punch-style": ["proposals"],
  "overlay-style": ["proposals"],
  "sound-volume": ["proposals"],
  music: ["music"],
  "remove-music": ["music", "proposals"],
  "fix-word": ["transcript"],
  chapter: ["writeup"],
  "remove-chapter": ["writeup"],
  writeup: ["writeup"],
  thumbnail: ["thumbnail"],
  describe: ["assets"],
  "remove-asset": ["assets", "proposals"],
};

/** The control behind a change that can repeat as it is dragged or typed: the op, what it is on, and the settings it sets. */
function stepKey(op: EditOp): string | undefined {
  const { type, ...rest } = op;
  if (!["captions", "speed", "frame", "overlay-style", "sound-volume", "music", "writeup", "thumbnail"].includes(type)) return undefined;
  const settings = op.type === "captions" ? op.captions : rest;
  const target = "sourceId" in op ? op.sourceId : "id" in op ? (op.id ?? "") : "";
  return [type, target, ...Object.keys(settings).filter((k) => k !== "id" && k !== "sourceId").sort()].join(":");
}

function snapshot(p: Project): Snapshot {
  return { segments: structuredClone(p.segments), statuses: Object.fromEntries(p.proposals.map((x) => [x.id, x.status])) };
}

function restore(p: Project, s: Snapshot): void {
  p.segments = structuredClone(s.segments);
  // Proposals made since the snapshot keep their status; ones it knew get theirs back.
  for (const x of p.proposals) x.status = s.statuses[x.id] ?? x.status;
}

/** The music track `id` names, or the only one when no id is given. */
function musicTrack(p: Project, id: string | undefined): Project["music"][number] {
  if (id === undefined && p.music.length > 1) throw new Error(`Say which music track: ${p.music.map((t) => `${t.id} (${t.name})`).join(", ")}`);
  const track = id === undefined ? p.music[0] : p.music.find((t) => t.id === id);
  if (!track) throw new Error(id === undefined ? "There is no music" : `Unknown music: ${id}`);
  return track;
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

/** `next` with an undo step for what `op` changed from `project`, if it changed anything. */
function remember(project: Project, next: Project, op: EditOp, keys: Tracked[], now: number): Project {
  const change = diffProject(project, next, keys);
  if (!change) return next;
  const { past } = next.history;
  const key = stepKey(op);
  const last = past.at(-1);
  if (key && last?.key === key && last.at !== undefined && now - last.at < SAME_STEP_MS) {
    // The drag goes on: the step keeps what was there before it started.
    last.at = now;
  } else {
    past.push({ ...snapshot(project), change, key, at: now });
    if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  }
  next.history.future = [];
  return next;
}

/**
 * Applies `op` to a copy of `project` and returns it, as one undo step: cuts
 * and decisions keep the segments and statuses, anything else what it replaced.
 * Unknown word or proposal ids are an error, not a silent no-op, so a stale UI
 * finds out.
 */
export function applyEdit(project: Project, op: EditOp, id: IdFactory, now: number = Date.now()): Project {
  const next = edit(project, op, id);
  const keys = TOUCHES[op.type];
  return keys ? remember(project, next, op, keys, now) : next;
}

function edit(project: Project, op: EditOp, id: IdFactory): Project {
  const p = structuredClone(project);
  const history = p.history;

  if (op.type === "undo" || op.type === "redo") {
    const [from, to] = op.type === "undo" ? [history.past, history.future] : [history.future, history.past];
    const step = from.pop();
    if (!step) return p;
    const back = snapshot(p);
    if (step.change) back.change = applyChange(p, step.change);
    to.push(back);
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

  if (op.type === "bars") {
    p.bars = op.bars;
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
    const track = musicTrack(p, op.id);
    if (op.volume !== undefined) track.volume = op.volume;
    if (op.duck !== undefined) track.duck = op.duck;
    if (op.description !== undefined) track.description = op.description;
    if (op.whole !== undefined) {
      for (const t of p.music) t.whole = false;
      track.whole = op.whole;
    }
    return p;
  }

  if (op.type === "remove-music") {
    const track = musicTrack(p, op.id);
    p.music = p.music.filter((t) => t.id !== track.id);
    p.proposals = p.proposals.filter((x) => x.music?.trackId !== track.id);
    return p;
  }

  if (op.type === "fix-word") {
    const at = p.transcript.findIndex((w) => w.id === op.wordId);
    if (at < 0) throw new Error(`Unknown words: ${op.wordId}`);
    p.transcript[at] = respell(p.transcript[at]!, op.text.trim());
    return p;
  }

  if (op.type === "chapter") {
    if (!p.transcript.some((w) => w.id === op.wordId)) throw new Error(`Unknown words: ${op.wordId}`);
    const w = (p.writeup ??= Writeup.parse({}));
    const here = w.chapters.find((c) => c.wordId === op.wordId);
    if (here) here.title = op.title;
    else if (w.chapters.length >= CHAPTERS.max) throw new Error(`A video can have at most ${CHAPTERS.max} chapters`);
    else w.chapters.push({ wordId: op.wordId, title: op.title });
    return p;
  }

  if (op.type === "remove-chapter") {
    if (!p.writeup?.chapters.some((c) => c.wordId === op.wordId)) throw new Error(`Unknown chapter: ${op.wordId}`);
    p.writeup.chapters = p.writeup.chapters.filter((c) => c.wordId !== op.wordId);
    return p;
  }

  if (op.type === "writeup") {
    const w = (p.writeup ??= Writeup.parse({}));
    if (op.description !== undefined) w.description = op.description;
    if (op.articleTitle !== undefined) w.article.title = op.articleTitle;
    if (op.article !== undefined) w.article.markdown = op.article;
    return p;
  }

  if (op.type === "thumbnail") {
    if (!p.thumbnail) throw new Error("Pick a frame for the thumbnail first");
    if (op.text !== undefined) p.thumbnail.text = op.text;
    if (op.textColor !== undefined) p.thumbnail.textColor = op.textColor;
    if (op.background !== undefined) p.thumbnail.background = op.background;
    if (op.textSide !== undefined) p.thumbnail.textSide = op.textSide;
    if (op.textBox !== undefined) p.thumbnail.textBox = op.textBox;
    if (op.behind !== undefined) p.thumbnail.behind = op.behind;
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
  if (op.type === "punch" || op.type === "overlay" || op.type === "slide" || op.type === "place-music") {
    const ids = new Set(op.wordIds);
    const words = p.transcript.filter((w) => ids.has(w.id));
    if (words.length !== ids.size) throw new Error(`Unknown words: ${op.wordIds.filter((w) => !p.transcript.some((x) => x.id === w)).slice(0, 5).join(", ")}`);
    const sourceId = words[0]!.sourceId;
    const what = op.type === "punch" ? "A punch-in" : op.type === "slide" ? "A slide" : op.type === "place-music" ? "Music" : "B-roll";
    if (words.some((w) => w.sourceId !== sourceId)) throw new Error(`${what} stays inside one recording`);
    const fields = { id: id(), sourceId, wordIds: words.sort((a, b) => a.start - b.start).map((w) => w.id), reason: "", confidence: 1, status: "rejected" as const };
    if (op.type === "punch") {
      added = punchProposal(fields, punchRange(words), op.style);
    } else if (op.type === "slide") {
      const range = punchRange(words);
      const asset = slideAsset(id(), op.brief, op.look, range[1] - range[0]);
      p.assets.push(asset);
      added = overlayProposal(fields, defaultOverlay(range, asset.id, "full"));
    } else if (op.type === "place-music") {
      if (!p.music.some((t) => t.id === op.trackId)) throw new Error(`Unknown music: ${op.trackId}`);
      added = musicProposal(fields, { range: punchRange(words), trackId: op.trackId });
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
