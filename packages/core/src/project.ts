// The project file, version 1. Everything an edit needs is here, in source
// time: the words, the kept segments, the AI's proposals. The output timeline
// is never stored; `buildTimeline` derives it (see timeline.ts).

import { z } from "zod";

export const AspectRatio = z.enum(["16:9", "9:16", "1:1"]);

export const MediaInfo = z.object({
  duration: z.number().positive(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  fps: z.number().nonnegative(),
  /** Variable frame rate: we render from the constant-frame-rate proxy instead. */
  vfr: z.boolean(),
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
});

export const Source = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  order: z.number().int(),
  media: MediaInfo,
  /** Horizontal crop centre for narrow aspect ratios, 0..1 of the frame width. */
  frameX: z.number().min(0).max(1).default(0.5),
  prep: z
    .object({ proxy: z.string(), wav: z.string(), waveform: z.string(), thumbs: z.string() })
    .nullable()
    .default(null),
  transcription: z.object({ backend: z.string(), model: z.string() }).nullable().default(null),
  silenceRanges: z.array(z.tuple([z.number(), z.number()])).default([]),
});

export const Word = z.object({
  id: z.string(),
  sourceId: z.string(),
  text: z.string(),
  /** Source seconds. */
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  confidence: z.number().min(0).max(1).optional(),
  /** What speech recognition heard, when a correction changed the text. */
  heard: z.string().optional(),
});

export const Segment = z.object({
  id: z.string(),
  sourceId: z.string(),
  sourceStart: z.number().nonnegative(),
  sourceEnd: z.number().nonnegative(),
  included: z.boolean(),
});

export const ProposalType = z.enum(["silence", "retake", "cleanup", "tighten", "visual", "punch-in"]);
export const ProposalStatus = z.enum(["pending", "accepted", "rejected"]);

export const Proposal = z.object({
  id: z.string(),
  type: ProposalType,
  sourceId: z.string(),
  /** The source range this proposal removes. Retakes may remove several ranges. */
  cuts: z.array(z.tuple([z.number(), z.number()])),
  wordIds: z.array(z.string()),
  keepWordIds: z.array(z.string()).default([]),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  status: ProposalStatus,
});

const captionFields = {
  enabled: z.boolean(),
  mode: z.enum(["word", "sentence"]),
  font: z.string().min(1).max(100),
  size: z.number().min(8).max(400),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  effect: z.enum(["none", "shadow"]),
  case: z.enum(["regular", "upper", "lower"]),
  background: z.enum(["none", "rounded"]),
  /** Vertical position of the caption block's baseline, 0 (top) .. 1 (bottom). */
  position: z.number().min(0).max(1),
};

export const Captions = z.object({
  enabled: captionFields.enabled.default(true),
  mode: captionFields.mode.default("sentence"),
  font: captionFields.font.default("Jost"),
  size: captionFields.size.default(54),
  color: captionFields.color.default("#FFFFFF"),
  effect: captionFields.effect.default("shadow"),
  case: captionFields.case.default("regular"),
  background: captionFields.background.default("none"),
  position: captionFields.position.default(0.82),
});

/** Some caption settings, with no defaults filled in, for changing just those. */
export const CaptionsPatch = z.object(captionFields).partial();

/** What undo puts back: the edit itself and the user's decisions, never the words or the proposals' content. */
export const Snapshot = z.object({
  segments: z.array(Segment),
  statuses: z.record(z.string(), ProposalStatus),
});

export const History = z.object({
  past: z.array(Snapshot).default([]),
  future: z.array(Snapshot).default([]),
});

/** The last file exported, so the project can point back to it. */
export const LastExport = z.object({
  path: z.string(),
  format: z.enum(["16:9", "9:16"]),
  at: z.string(),
});

/** Where a short came from: the long video's project and why the AI editor picked this stretch. */
export const Origin = z.object({
  projectId: z.string(),
  name: z.string(),
  reason: z.string(),
});

/** A short made from this project, by its own project id. */
export const ShortRef = z.object({ id: z.string(), title: z.string(), seconds: z.number().nonnegative() });

export const Project = z.object({
  version: z.literal(1),
  id: z.string(),
  name: z.string(),
  language: z.string().default("en"),
  aspectRatio: AspectRatio.default("16:9"),
  speed: z.number().min(0.5).max(2).default(1),
  /** Bumped on every write; a write based on an older revision is refused. */
  revision: z.number().int().nonnegative(),
  /** What the user asked the AI editor for, kept for the next run. */
  brief: z.string().default(""),
  /** The AI editor's title for the video; empty until it has run. */
  suggestedTitle: z.string().default(""),
  sources: z.array(Source),
  transcript: z.array(Word),
  segments: z.array(Segment),
  proposals: z.array(Proposal),
  captions: Captions,
  history: History.default({ past: [], future: [] }),
  lastExport: LastExport.nullable().default(null),
  /** Set on a short: the project it was cut from. */
  origin: Origin.nullable().default(null),
  /** Shorts made from this project, newest last. */
  shorts: z.array(ShortRef).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AspectRatio = z.infer<typeof AspectRatio>;
export type MediaInfo = z.infer<typeof MediaInfo>;
export type Source = z.infer<typeof Source>;
export type Word = z.infer<typeof Word>;
export type Segment = z.infer<typeof Segment>;
export type Proposal = z.infer<typeof Proposal>;
export type Captions = z.infer<typeof Captions>;
export type Snapshot = z.infer<typeof Snapshot>;
export type LastExport = z.infer<typeof LastExport>;
export type Origin = z.infer<typeof Origin>;
export type ShortRef = z.infer<typeof ShortRef>;
export type Project = z.infer<typeof Project>;
export type Range = [number, number];
