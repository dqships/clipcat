// Draws a thumbnail on a canvas: the background, the text big in its box,
// then the cut-out subject on top, so the text sits behind them (or the text
// last, over everything). The same drawing is the preview and, saved as a
// PNG, the file. The thumbnail has the video's shape: wide, or tall for 9:16.

import { type AspectRatio, type Project, type Thumbnail, type ThumbnailColor, cropOffset, framingAt } from "@clipcat/core";
import tokens from "../../../../design/tokens.json";

export type Size = { width: number; height: number };
export type Box = { x: number; y: number; width: number; height: number };

/** YouTube's recommended size for a wide video, and a Short's full frame for a tall one. */
const WIDE: Size = { width: 1280, height: 720 };
const TALL: Size = { width: 1080, height: 1920 };

/** The thumbnail's size for a video of this shape. */
export const thumbnailSize = (format: AspectRatio): Size => (format === "9:16" ? TALL : WIDE);

/** The palette, the same in either theme: a thumbnail doesn't change with the app's. */
export const THUMBNAIL_COLORS: Record<ThumbnailColor, string> = tokens.thumbnail;

/** The outline that keeps each text colour readable on a busy frame: paper around the dark ones, ink around the rest. */
const OUTLINE: Record<ThumbnailColor, "paper" | "ink"> = {
  paper: "ink",
  ink: "paper",
  tape: "ink",
  red: "paper",
  orange: "ink",
  lime: "ink",
  green: "paper",
  sky: "ink",
  blue: "paper",
  pink: "ink",
  violet: "paper",
};

const FONT = "Jost";
const WEIGHT = 800;
const LEADING = 1.02;
const MAX_LINES = 4;
/** Measured against a wide thumbnail's 720 px height; a tall one scales them up. */
const MARGIN = 64;
const MIN_SIZE = 24;
const BLUR = 28;
/** The largest text is about a third of its box's height, so three lines fill it. */
const MAX_SIZE_SHARE = 0.32;
/** A text box no smaller than this share of the thumbnail on either side. */
export const MIN_BOX = 0.1;

const unit = (size: Size) => Math.min(size.width, size.height) / WIDE.height;

/**
 * Where a picture of this size goes on the thumbnail. "cover" fills it,
 * cropped at the edges, with `offset` (0 left .. 1 right) placing a crop
 * across a wider picture; "contain" shows all of it.
 */
export function placePicture(width: number, height: number, size: Size, fit: "cover" | "contain", offset = 0.5): Box {
  const scale = (fit === "cover" ? Math.max : Math.min)(size.width / width, size.height / height);
  const w = width * scale;
  const h = height * scale;
  return { x: (size.width - w) * offset, y: (size.height - h) / 2, width: w, height: h };
}

/** The box the text fits in when the user hasn't moved it: most of one half, or the top of a tall thumbnail. */
export function textBox(side: Thumbnail["textSide"], size: Size): Box {
  const m = MARGIN * unit(size);
  if (size.height > size.width) return { x: m, y: m, width: size.width - 2 * m, height: size.height * 0.42 - m };
  const width = size.width * 0.56 - m;
  return { x: side === "left" ? m : size.width - m - width, y: m, width, height: size.height - 2 * m };
}

/** The text's box in pixels: where the user put it, else the side's default. */
export function thumbnailTextBox(thumbnail: Pick<Thumbnail, "textSide" | "textBox">, size: Size): Box {
  const b = thumbnail.textBox;
  if (!b) return textBox(thumbnail.textSide, size);
  return { x: b.x * size.width, y: b.y * size.height, width: b.width * size.width, height: b.height * size.height };
}

/** A box (as shares of the thumbnail) kept at least MIN_BOX big and inside the thumbnail. */
export function clampBox(b: Box): Box {
  const width = Math.min(1, Math.max(MIN_BOX, b.width));
  const height = Math.min(1, Math.max(MIN_BOX, b.height));
  return { x: Math.min(1 - width, Math.max(0, b.x)), y: Math.min(1 - height, Math.max(0, b.y)), width, height };
}

/**
 * The text broken into lines at the largest size that fits the box: each
 * line no wider than it, no more than four lines, and no word split. A
 * bigger box takes bigger text.
 */
export function fitText(text: string, box: { width: number; height: number }, measure: (line: string, size: number) => number, scale = 1): { lines: string[]; size: number } {
  const max = Math.max(MIN_SIZE * scale, Math.round(box.height * MAX_SIZE_SHARE));
  const min = Math.round(MIN_SIZE * scale);
  const step = Math.max(2, Math.round(max / 60));
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lines: [], size: max };
  let lines: string[] = [];
  for (let size = max; size >= min; size -= step) {
    lines = [];
    for (const word of words) {
      const last = lines.at(-1);
      if (last !== undefined && measure(`${last} ${word}`, size) <= box.width) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    const fits = lines.every((l) => measure(l, size) <= box.width) && lines.length <= MAX_LINES && lines.length * size * LEADING <= box.height;
    if (fits) return { lines, size };
  }
  return { lines, size: min };
}

export type ThumbnailPictures = { frame: HTMLImageElement | ImageBitmap; subject: HTMLImageElement | ImageBitmap | null };
export type ThumbnailProject = Pick<Project, "aspectRatio" | "sources"> & { thumbnail: Thumbnail };

/**
 * Where the frame goes, the way the video shows it: a tall video crops
 * around the speaker, as its export does; a wide one shows the whole frame,
 * so a vertical recording isn't blown up to fill it.
 */
export function framePlacement(project: ThumbnailProject, frame: Size, format: AspectRatio = project.aspectRatio): { at: Box; fills: boolean } {
  const size = thumbnailSize(format);
  if (format === "9:16") {
    const t = project.thumbnail;
    const source = project.sources.find((s) => s.id === t.sourceId);
    const offset = source ? cropOffset(framingAt(source, t.time, t.time), frame.width / frame.height, size.width / size.height) : 0.5;
    return { at: placePicture(frame.width, frame.height, size, "cover", offset), fills: true };
  }
  const at = placePicture(frame.width, frame.height, size, "contain");
  return { at, fills: at.width >= size.width - 1 && at.height >= size.height - 1 };
}

/** Draws the whole thumbnail; the canvas must be thumbnailSize(format) and the font loaded. */
export function drawThumbnail(g: CanvasRenderingContext2D, pictures: ThumbnailPictures, project: ThumbnailProject, text: string, format: AspectRatio = project.aspectRatio): void {
  const { frame, subject } = pictures;
  const thumbnail = project.thumbnail;
  const size = thumbnailSize(format);
  const { at, fills } = framePlacement(project, frame, format);
  const blurred = () => {
    const all = placePicture(frame.width, frame.height, size, "cover");
    g.filter = `blur(${BLUR * unit(size)}px)`;
    // Drawn a little bigger, so the blur doesn't fade in from the edges.
    const pad = BLUR * 2 * unit(size);
    g.drawImage(frame, all.x - pad, all.y - pad, all.width + pad * 2, all.height + pad * 2);
    g.filter = "none";
  };
  g.save();
  g.clearRect(0, 0, size.width, size.height);
  if (thumbnail.background === "blur") {
    blurred();
  } else if (thumbnail.background === "frame") {
    // Where the frame doesn't reach the edges, the same frame blurred fills in.
    if (!fills) blurred();
    g.drawImage(frame, at.x, at.y, at.width, at.height);
  } else {
    g.fillStyle = THUMBNAIL_COLORS[thumbnail.background];
    g.fillRect(0, 0, size.width, size.height);
  }

  const box = thumbnailTextBox(thumbnail, size);
  const { lines, size: type } = fitText(
    text.toUpperCase(),
    box,
    (line, s) => {
      g.font = `${WEIGHT} ${s}px ${FONT}`;
      return g.measureText(line).width + s * 0.08;
    },
    unit(size),
  );
  g.font = `${WEIGHT} ${type}px ${FONT}`;
  g.textAlign = thumbnail.textSide === "left" ? "left" : "right";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = type * 0.08;
  g.strokeStyle = THUMBNAIL_COLORS[OUTLINE[thumbnail.textColor]];
  g.fillStyle = THUMBNAIL_COLORS[thumbnail.textColor];
  const x = thumbnail.textSide === "left" ? box.x : box.x + box.width;
  const top = box.y + box.height / 2 - ((lines.length - 1) * type * LEADING) / 2;

  const words = () =>
    lines.forEach((line, i) => {
      g.strokeText(line, x, top + i * type * LEADING);
      g.fillText(line, x, top + i * type * LEADING);
    });
  // The subject goes where it is in the frame: over the text, or under it.
  const person = () => subject && g.drawImage(subject, at.x, at.y, at.width, at.height);
  if (thumbnail.behind) {
    words();
    person();
  } else {
    person();
    words();
  }
  g.restore();
}

/** The font has to be loaded before the canvas can draw with it. */
export const loadThumbnailFont = async (): Promise<void> => {
  await document.fonts?.load(`${WEIGHT} ${MIN_SIZE}px ${FONT}`);
};
