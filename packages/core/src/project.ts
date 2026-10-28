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
  /** Where the speaker is across the frame (0..1) when no faces were found, or as the user set it. */
  frameX: z.number().min(0).max(1).default(0.5),
  /** "auto" follows the faces found; "manual" uses frameX everywhere. */
  framing: z.enum(["auto", "manual"]).default("auto"),
  /** The speaker's centre (0..1 across) in frames sampled through the recording; null until looked for. */
  faces: z.array(z.object({ t: z.number().nonnegative(), x: z.number().min(0).max(1) })).nullable().default(null),
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

export const ProposalType = z.enum(["silence", "retake", "cleanup", "tighten", "visual", "punch-in", "sound"]);
export const ProposalStatus = z.enum(["pending", "accepted", "rejected"]);

/** How a punch-in zooms: snaps in, pushes in quickly, or creeps in over its length. */
export const PunchStyle = z.enum(["cut", "zoom-in", "slow-zoom"]);

/** A punch-in: the picture zooms toward the speaker over a source range. */
export const Punch = z.object({
  range: z.tuple([z.number(), z.number()]),
  style: PunchStyle,
  scale: z.number().min(1.05).max(1.6),
});

/** How b-roll covers the speaker: the whole frame, or a window in one corner. */
export const OverlayPlacement = z.enum(["full", "pip"]);
/** The window's shape for picture in picture. */
export const PipShape = z.enum(["rectangle", "square", "circle"]);
export const PipCorner = z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]);

/** B-roll: one of the project's media shown over a source range, while the speaker's sound plays on. */
export const Overlay = z.object({
  range: z.tuple([z.number(), z.number()]),
  assetId: z.string(),
  placement: OverlayPlacement,
  shape: PipShape.default("rectangle"),
  corner: PipCorner.default("top-right"),
  /** The window's width as a share of the frame's (its shorter side, for a square or circle). */
  size: z.number().min(0.2).max(0.6).default(0.35),
  /** Seconds into a video where it starts playing. */
  offset: z.number().nonnegative().default(0),
});

/** A sound effect from ClipCat's library, landing at a moment in a recording, at a volume. */
export const SoundCue = z.object({
  at: z.number().nonnegative(),
  effect: z.string().regex(/^[a-z0-9-]+$/),
  volume: z.number().min(0).max(1).default(0.7),
});

/**
 * Music under the whole video: the user's file, a copy prepared for the
 * preview (relative to the project folder; null until made), how loud it
 * plays, and whether it dips while someone speaks.
 */
export const Music = z.object({
  path: z.string(),
  name: z.string(),
  duration: z.number().positive(),
  volume: z.number().min(0).max(1).default(0.15),
  duck: z.boolean().default(true),
  prep: z.string().nullable().default(null),
});

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
  /** Set on a punch-in, which cuts nothing; accepted, it zooms. */
  punch: Punch.nullable().default(null),
  /** Set on b-roll ("visual"), which cuts nothing either; accepted, it shows. */
  overlay: Overlay.nullable().default(null),
  /** Set on a sound effect, which cuts nothing; accepted, it plays. */
  sound: SoundCue.nullable().default(null),
});

/** How a motion slide looks: on warm paper, on ink, or over the speaker with no background of its own. */
export const SlideLook = z.enum(["paper", "ink", "overlay"]);

/** A motion slide: what it should show, and the HTML the AI editor wrote for it (empty until designed). */
export const Slide = z.object({
  brief: z.string().max(1000),
  look: SlideLook,
  html: z.string().max(200_000),
});

/**
 * A picture, a video or a motion slide, shown as b-roll. Pictures and videos
 * are the user's own and read from where they are; a slide is HTML the AI
 * editor writes. It is read from where it
 * is; what the preview and the AI editor look at is prepared beside the
 * project.
 */
export const Asset = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  kind: z.enum(["video", "image", "slide"]),
  media: z.object({
    /** 0 for a picture; a slide's own length. */
    duration: z.number().nonnegative(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
  }),
  /**
   * Relative to the project folder: what the preview shows (a light H.264
   * copy of a video, a PNG of a picture, which the export also uses; nothing
   * for a slide, which the preview runs live) and a few small frames for the
   * AI editor to look at. Null until prepared, or for a slide, designed.
   */
  prep: z.object({ preview: z.string(), frames: z.array(z.string()) }).nullable().default(null),
  /** What it shows, in a sentence or two: written by the AI editor or the user, read when placing b-roll. */
  description: z.string().max(1000).default(""),
  /** Set on a slide. */
  slide: Slide.nullable().default(null),
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

/** A chapter: its title, on the word it starts with. */
export const Chapter = z.object({ wordId: z.string(), title: z.string().trim().min(1).max(100) });
export const Article = z.object({ title: z.string().trim().max(200), markdown: z.string().max(100_000) });
/** What goes with the video when it is posted (see writeup.ts). */
export const Writeup = z.object({
  chapters: z.array(Chapter).max(30).default([]),
  description: z.string().max(5000).default(""),
  article: Article.default({ title: "", markdown: "" }),
});

/** The colours a thumbnail can use, from the app's palette. */
export const ThumbnailColor = z.enum(["paper", "ink", "tape"]);
/** What fills the thumbnail behind the text: the frame itself, the frame blurred, or a flat colour. */
export const ThumbnailBackground = z.enum(["frame", "blur", "paper", "ink", "tape"]);

/**
 * The video's thumbnail: a frame from a recording, its subject cut out so the
 * text can sit behind them, and the text and colours on it. The pictures are
 * paths in the project's folder; `subject` is null while it is being cut out,
 * or when nothing in the frame stood out.
 */
export const Thumbnail = z.object({
  sourceId: z.string(),
  /** Source seconds. */
  time: z.number().nonnegative(),
  frame: z.string(),
  subject: z.string().nullable().default(null),
  text: z.string().max(80).default(""),
  textColor: ThumbnailColor.default("paper"),
  background: ThumbnailBackground.default("frame"),
  /** Which half the text sits in. */
  textSide: z.enum(["left", "right"]).default("left"),
  /** The subject in front of the text (true) or the text over everything. */
  behind: z.boolean().default(true),
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
  /** Pictures and videos for b-roll. */
  assets: z.array(Asset).default([]),
  /** Music under the video, or none. */
  music: Music.nullable().default(null),
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
  /** Chapters, a description and an article; null until written. */
  writeup: Writeup.nullable().default(null),
  /** The thumbnail being made; null until a frame is picked. */
  thumbnail: Thumbnail.nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AspectRatio = z.infer<typeof AspectRatio>;
export type MediaInfo = z.infer<typeof MediaInfo>;
export type Source = z.infer<typeof Source>;
export type Word = z.infer<typeof Word>;
export type Segment = z.infer<typeof Segment>;
export type Proposal = z.infer<typeof Proposal>;
export type PunchStyle = z.infer<typeof PunchStyle>;
export type Punch = z.infer<typeof Punch>;
export type OverlayPlacement = z.infer<typeof OverlayPlacement>;
export type PipShape = z.infer<typeof PipShape>;
export type PipCorner = z.infer<typeof PipCorner>;
export type Overlay = z.infer<typeof Overlay>;
export type Asset = z.infer<typeof Asset>;
export type SoundCue = z.infer<typeof SoundCue>;
export type Music = z.infer<typeof Music>;
export type SlideLook = z.infer<typeof SlideLook>;
export type Slide = z.infer<typeof Slide>;
export type Captions = z.infer<typeof Captions>;
export type Snapshot = z.infer<typeof Snapshot>;
export type LastExport = z.infer<typeof LastExport>;
export type Chapter = z.infer<typeof Chapter>;
export type Article = z.infer<typeof Article>;
export type Writeup = z.infer<typeof Writeup>;
export type ThumbnailColor = z.infer<typeof ThumbnailColor>;
export type ThumbnailBackground = z.infer<typeof ThumbnailBackground>;
export type Thumbnail = z.infer<typeof Thumbnail>;
export type Origin = z.infer<typeof Origin>;
export type ShortRef = z.infer<typeof ShortRef>;
export type Project = z.infer<typeof Project>;
export type Range = [number, number];
