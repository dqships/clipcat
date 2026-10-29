// Captions from the kept words: grouped into short cues on the output
// timeline, then written as ASS (burned in by ffmpeg's libass) and SRT (a
// sidecar for players and uploads). The preview shows the same cues.

import { isWordKept } from "./edits";
import type { Captions, Project } from "./project";
import { type Timeline, sourceToOutput } from "./timeline";

export type CueWord = { text: string; start: number; end: number };
/** One caption on screen, in output seconds. */
export type Cue = { start: number; end: number; words: CueWord[] };

/** The frame the captions are laid out for. */
export type Frame = { width: number; height: number };

/** Longest cue, in characters, for a landscape and a portrait frame. */
const MAX_CHARS = { wide: 38, tall: 22 };
/** Word-by-word cues are a few words at a time. */
const MAX_WORDS_WORD_MODE = 3;
/** A pause this long (output seconds) starts a new cue. */
const BREAK_GAP = 0.6;
/** How long a cue lingers after its last word, if nothing follows. */
const LINGER = 0.3;
const MIN_CUE = 0.4;
/** Caption sizes are given for a 1080-pixel frame and scaled from there. */
const BASE = 1080;

/** A caption size (given for 1080p) in pixels of `frame`; portrait frames get bigger type, as short-form captions are. */
export function captionPixels(size: number, frame: Frame): number {
  const tall = frame.height > frame.width;
  return Math.round(size * (Math.min(frame.width, frame.height) / BASE) * (tall ? 1.6 : 1));
}

/** Every kept word in play order, with its times on the output timeline. */
export function outputWords(project: Pick<Project, "sources" | "transcript" | "segments">, timeline: Timeline): CueWord[] {
  const order = new Map(project.sources.map((s) => [s.id, s.order]));
  const words = project.transcript
    .filter((w) => order.has(w.sourceId) && isWordKept(project.segments, w))
    .sort((a, b) => (order.get(a.sourceId) ?? 0) - (order.get(b.sourceId) ?? 0) || a.start - b.start);
  const out: CueWord[] = [];
  for (const w of words) {
    const mid = sourceToOutput(timeline, w.sourceId, (w.start + w.end) / 2);
    if (mid === null) continue;
    // A word's edges can fall just outside the kept range it sits in; clamp to its middle.
    const start = sourceToOutput(timeline, w.sourceId, w.start) ?? mid;
    const end = sourceToOutput(timeline, w.sourceId, Math.max(w.start, w.end - 1e-3)) ?? mid;
    out.push({ text: w.text.trim(), start: Math.min(start, mid), end: Math.max(end, mid) });
  }
  return out.filter((w) => w.text.length > 0);
}

/**
 * Groups words into cues: a cue ends at the end of a sentence, at a pause,
 * or before it would grow past the line length. Word-by-word mode keeps cues
 * to a few words, for captions that pop in as they're spoken.
 */
export function captionCues(words: CueWord[], mode: Captions["mode"], frame: Frame): Cue[] {
  const maxChars = frame.height > frame.width ? MAX_CHARS.tall : MAX_CHARS.wide;
  const maxWords = mode === "word" ? MAX_WORDS_WORD_MODE : Number.POSITIVE_INFINITY;
  const cues: Cue[] = [];
  let current: CueWord[] = [];
  const flush = () => {
    if (current.length === 0) return;
    cues.push({ start: current[0]!.start, end: current[current.length - 1]!.end, words: current });
    current = [];
  };
  for (const w of words) {
    const last = current[current.length - 1];
    const length = current.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (last && (w.start - last.end > BREAK_GAP || length > maxChars || current.length >= maxWords)) flush();
    current.push(w);
    if (/[.?!]["”’)]*$/.test(w.text)) flush();
  }
  flush();
  // Hold each cue until the next one, or a moment past its last word.
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i]!;
    const next = cues[i + 1];
    const until = next ? Math.min(next.start, cue.end + BREAK_GAP) : cue.end + LINGER;
    cue.end = Math.max(cue.end, until, Math.min(cue.start + MIN_CUE, next?.start ?? Number.POSITIVE_INFINITY));
  }
  return cues;
}

export function applyCase(text: string, c: Captions["case"]): string {
  return c === "upper" ? text.toUpperCase() : c === "lower" ? text.toLowerCase() : text;
}

/** "#RRGGBB" → ASS "&HAABBGGRR" (alpha 00 is opaque). */
export function assColor(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  const [r, g, b] = m ? [m[1], m[2], m[3]] : ["FF", "FF", "FF"];
  const a = Math.round(Math.min(255, Math.max(0, alpha))).toString(16).padStart(2, "0");
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

/** 3725.5 → "1:02:05.50" (ASS centiseconds). */
export function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** 3725.5 → "01:02:05,500". */
export function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

/** Text libass would read as markup: override blocks and escapes. */
const assText = (text: string) => text.replace(/[{}]/g, "").replace(/\\/g, "/").replace(/\s+/g, " ");

/** The font name libass looks up in the bundled fonts directory. */
export const CAPTION_FONTS: Record<string, string> = { Jost: "Jost SemiBold" };

/** Ready-made caption colours for the text and the box; any other hex works too. */
export const CAPTION_SWATCHES = [
  { name: "White", color: "#FFFFFF" },
  { name: "Black", color: "#000000" },
  { name: "Splice tape", color: "#F2B705" },
  { name: "Red", color: "#C8361D" },
] as const;

/** Highlight for the word being spoken in word-by-word captions (the brand accent). */
export const CAPTION_HIGHLIGHT = "#F2B705";

/** The highlight for captions in `color`: white when the text is already the accent, so the spoken word still stands out. */
export const captionHighlight = (color: string) => (color.toUpperCase() === CAPTION_HIGHLIGHT ? "#FFFFFF" : CAPTION_HIGHLIGHT);

/**
 * An ASS script for the cues, laid out for `frame`. In word-by-word mode each
 * cue is written once per word, with that word in the highlight colour.
 */
export function toAss(cues: Cue[], style: Captions, frame: Frame): string {
  const scale = Math.min(frame.width, frame.height) / BASE;
  const size = captionPixels(style.size, frame);
  const shadow = style.effect === "shadow";
  const box = style.background === "rounded";
  const outline = box ? Math.round(12 * scale) : shadow ? Math.max(1, Math.round(2 * scale)) : 0;
  const margin = Math.round(frame.width * 0.08);
  const marginV = Math.round((1 - style.position) * frame.height);
  const font = CAPTION_FONTS[style.font] ?? style.font;
  const primary = assColor(style.color);
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${frame.width}`,
    `PlayResY: ${frame.height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    [
      "Style: Default",
      font,
      size,
      primary,
      primary,
      box ? assColor(style.boxColor, 0x60) : assColor("#000000", 0x40),
      assColor("#000000", shadow ? 0x80 : 0xff),
      0, 0, 0, 0, 100, 100, 0, 0,
      box ? 3 : 1,
      outline,
      shadow && !box ? Math.max(1, Math.round(3 * scale)) : 0,
      2,
      margin,
      margin,
      marginV,
      1,
    ].join(","),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const line = (start: number, end: number, text: string) => `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${text}`;
  const events: string[] = [];
  const highlight = assColor(captionHighlight(style.color));
  for (const cue of cues) {
    const words = cue.words.map((w) => assText(applyCase(w.text, style.case)));
    if (style.mode === "word") {
      cue.words.forEach((w, i) => {
        const end = i + 1 < cue.words.length ? cue.words[i + 1]!.start : cue.end;
        if (end - w.start <= 0) return;
        const text = words.map((t, j) => (j === i ? `{\\c${highlight}}${t}{\\c${primary}}` : t)).join(" ");
        events.push(line(i === 0 ? cue.start : w.start, end, text));
      });
    } else {
      events.push(line(cue.start, cue.end, words.join(" ")));
    }
  }
  return `${[...header, ...events].join("\n")}\n`;
}

/** An SRT file for the cues, always sentence by sentence. */
export function toSrt(cues: Cue[], c: Captions["case"]): string {
  return cues
    .map((cue, i) => `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${applyCase(cue.words.map((w) => w.text).join(" "), c)}\n`)
    .join("\n");
}
