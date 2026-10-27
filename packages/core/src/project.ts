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

export const Captions = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(["word", "sentence"]).default("sentence"),
  font: z.string().default("Jost"),
  size: z.number().positive().default(54),
  color: z.string().default("#FFFFFF"),
  effect: z.enum(["none", "shadow"]).default("shadow"),
  case: z.enum(["regular", "upper", "lower"]).default("regular"),
  background: z.enum(["none", "rounded"]).default("none"),
  /** Vertical position of the caption block's baseline, 0 (top) .. 1 (bottom). */
  position: z.number().min(0).max(1).default(0.82),
});

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
export type Project = z.infer<typeof Project>;
export type Range = [number, number];
