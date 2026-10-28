// Draws a thumbnail on a canvas: the background, the text big in one half,
// then the cut-out subject on top, so the text sits behind them (or the text
// last, over everything). The same
// drawing is the preview and, saved as a PNG, the file.

import type { Thumbnail, ThumbnailColor } from "@clipcat/core";
import tokens from "../../../../design/tokens.json";

/** YouTube's recommended size. */
export const THUMBNAIL = { width: 1280, height: 720 };

/** The palette, the same in either theme: a thumbnail doesn't change with the app's. */
export const THUMBNAIL_COLORS: Record<ThumbnailColor, string> = {
  paper: tokens.light["color-background"],
  ink: tokens.light["color-text"],
  tape: tokens.light["color-accent"],
};

/** The outline that keeps each text colour readable on a busy frame. */
const OUTLINE: Record<ThumbnailColor, ThumbnailColor> = { paper: "ink", ink: "paper", tape: "ink" };

const FONT = "Jost";
const WEIGHT = 800;
const MARGIN = 64;
const LEADING = 1.02;
const SIZES = { max: 190, min: 48, step: 4 };
const MAX_LINES = 4;
const BLUR = 28;

/** Where a picture of this size goes to cover the whole thumbnail, cropped at the edges. */
export function cover(width: number, height: number): { x: number; y: number; width: number; height: number } {
  const scale = Math.max(THUMBNAIL.width / width, THUMBNAIL.height / height);
  const w = width * scale;
  const h = height * scale;
  return { x: (THUMBNAIL.width - w) / 2, y: (THUMBNAIL.height - h) / 2, width: w, height: h };
}

/** The box the text fits in: most of one half. */
export function textBox(side: Thumbnail["textSide"]): { x: number; y: number; width: number; height: number } {
  const width = THUMBNAIL.width * 0.56 - MARGIN;
  return { x: side === "left" ? MARGIN : THUMBNAIL.width - MARGIN - width, y: MARGIN, width, height: THUMBNAIL.height - 2 * MARGIN };
}

/**
 * The text broken into lines at the largest size that fits the box: each
 * line no wider than it, no more than four lines, and no word split.
 */
export function fitText(text: string, box: { width: number; height: number }, measure: (line: string, size: number) => number): { lines: string[]; size: number } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lines: [], size: SIZES.max };
  let lines: string[] = [];
  for (let size = SIZES.max; size >= SIZES.min; size -= SIZES.step) {
    lines = [];
    for (const word of words) {
      const last = lines.at(-1);
      if (last !== undefined && measure(`${last} ${word}`, size) <= box.width) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    const fits = lines.every((l) => measure(l, size) <= box.width) && lines.length <= MAX_LINES && lines.length * size * LEADING <= box.height;
    if (fits) return { lines, size };
  }
  return { lines, size: SIZES.min };
}

export type ThumbnailPictures = { frame: HTMLImageElement | ImageBitmap; subject: HTMLImageElement | ImageBitmap | null };

/** Draws the whole thumbnail; the canvas must be THUMBNAIL's size and the font loaded. */
export function drawThumbnail(g: CanvasRenderingContext2D, pictures: ThumbnailPictures, thumbnail: Thumbnail, text: string): void {
  const { frame, subject } = pictures;
  const at = cover(frame.width, frame.height);
  g.save();
  g.clearRect(0, 0, THUMBNAIL.width, THUMBNAIL.height);
  if (thumbnail.background === "frame" || thumbnail.background === "blur") {
    if (thumbnail.background === "blur") {
      g.filter = `blur(${BLUR}px)`;
      // Drawn a little bigger, so the blur doesn't fade in from the edges.
      g.drawImage(frame, at.x - BLUR * 2, at.y - BLUR * 2, at.width + BLUR * 4, at.height + BLUR * 4);
      g.filter = "none";
    } else {
      g.drawImage(frame, at.x, at.y, at.width, at.height);
    }
  } else {
    g.fillStyle = THUMBNAIL_COLORS[thumbnail.background];
    g.fillRect(0, 0, THUMBNAIL.width, THUMBNAIL.height);
  }

  const box = textBox(thumbnail.textSide);
  g.font = `${WEIGHT} ${SIZES.max}px ${FONT}`;
  const { lines, size } = fitText(text.toUpperCase(), box, (line, s) => {
    g.font = `${WEIGHT} ${s}px ${FONT}`;
    return g.measureText(line).width + s * 0.08;
  });
  g.font = `${WEIGHT} ${size}px ${FONT}`;
  g.textAlign = thumbnail.textSide === "left" ? "left" : "right";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = size * 0.08;
  g.strokeStyle = THUMBNAIL_COLORS[OUTLINE[thumbnail.textColor]];
  g.fillStyle = THUMBNAIL_COLORS[thumbnail.textColor];
  const x = thumbnail.textSide === "left" ? box.x : box.x + box.width;
  const top = box.y + box.height / 2 - ((lines.length - 1) * size * LEADING) / 2;

  const words = () =>
    lines.forEach((line, i) => {
      g.strokeText(line, x, top + i * size * LEADING);
      g.fillText(line, x, top + i * size * LEADING);
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
  await document.fonts?.load(`${WEIGHT} ${SIZES.max}px ${FONT}`);
};
