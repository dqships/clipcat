// The export, in pieces a long video can survive: the timeline snapped to
// whole output frames, the picture rendered in chunks of a few minutes (each
// seeking straight to its part of the recordings), the sound in one pass, and
// the two joined without re-encoding into an MP4 that starts playing before
// it has fully downloaded. Snapping every kept range to whole frames keeps the
// picture and the sound the same length piece by piece, so they stay in sync
// however many cuts there are.

import {
  PUNCH,
  type Project,
  type Source,
  type Timeline,
  type TimelineItem,
  type TimedPunch,
  cropOffset,
  framingAt,
  punchFocus,
} from "@clipcat/core";
import { type Encoder, encoderArgs } from "./encoders";

export type ExportFormat = "16:9" | "9:16";
export type Size = { width: number; height: number };

/** Tallest landscape export; smaller recordings aren't scaled up. */
export const MAX_WIDE_HEIGHT = 1440;
export const TALL: Size = { width: 1080, height: 1920 };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** 16:9 at the recordings' own height up to 1440p, or 1080×1920 for 9:16. */
export function exportSize(format: ExportFormat, sources: Source[]): Size {
  if (format === "9:16") return TALL;
  const tallest = Math.max(0, ...sources.filter((s) => s.media.videoCodec && s.media.height > 0).map((s) => s.media.height));
  const height = even(Math.min(MAX_WIDE_HEIGHT, tallest || 1080));
  return { width: even((height * 16) / 9), height };
}

/** The frame rate of the export: the fastest recording's, capped at 60. */
export function exportFps(sources: Source[]): number {
  const fps = Math.max(0, ...sources.map((s) => (s.media.videoCodec ? s.media.fps : 0)));
  return fps > 0 ? Math.min(60, Math.round(fps)) : 30;
}

/** Output seconds per video chunk. */
export const CHUNK_SECONDS = 240;
const SAMPLE_RATE = 48000;

/** A kept range in whole output frames: `frames` frames from frame `from` of its recording, counted on the export's frame grid. */
export type FramedItem = TimelineItem & { from: number; frames: number };
export type FramedTimeline = Omit<Timeline, "items"> & { items: FramedItem[]; fps: number; frames: number };

/** One video render: some frames of the timeline, starting at output frame `start`. */
export type Chunk = { items: FramedItem[]; start: number; frames: number };

/** Source seconds that one output frame covers. */
const frameStep = (fps: number, speed: number) => speed / fps;

/**
 * The timeline with every kept range snapped to the frame grid: frame k of a
 * recording starts at k × speed / fps seconds. Ranges too short for a frame are
 * dropped. Captions are timed against this, so they land on the same frames.
 */
export function frameTimeline(timeline: Timeline, fps: number): FramedTimeline {
  const step = frameStep(fps, timeline.speed);
  const items: FramedItem[] = [];
  let frames = 0;
  for (const item of timeline.items) {
    const from = Math.round(item.sourceStart / step);
    const n = Math.round(item.sourceEnd / step) - from;
    if (n <= 0) continue;
    items.push({
      ...item,
      sourceStart: from * step,
      sourceEnd: (from + n) * step,
      outputStart: frames / fps,
      outputEnd: (frames + n) / fps,
      from,
      frames: n,
    });
    frames += n;
  }
  return { items, duration: frames / fps, speed: timeline.speed, fps, frames };
}

/** Splits the timeline into renders of at most `size` frames, cutting a long range in two where it must. */
export function exportChunks(timeline: FramedTimeline, size: number): Chunk[] {
  const chunks: Chunk[] = [];
  let current: FramedItem[] = [];
  let filled = 0;
  let start = 0;
  for (const item of timeline.items) {
    let rest = item;
    while (rest.frames > 0) {
      const take = Math.min(rest.frames, size - filled);
      current.push({ ...rest, frames: take });
      filled += take;
      rest = { ...rest, from: rest.from + take, frames: rest.frames - take };
      if (filled === size) {
        chunks.push({ items: current, start, frames: filled });
        start += filled;
        current = [];
        filled = 0;
      }
    }
  }
  if (filled > 0) chunks.push({ items: current, start, frames: filled });
  return chunks;
}

type Shape = {
  project: Pick<Project, "sources" | "speed">;
  /** The punch-ins in effect, timed on the framed timeline (see timedPunches). */
  punches?: TimedPunch[];
  format: ExportFormat;
  fps: number;
  /** The file each source is read from: the original, or the proxy for audio-only sources. */
  inputs: Map<string, string>;
  /** The filter graph is written here (relative to the working directory) and read with -filter_complex_script. */
  graphFile: string;
  out: string;
};

const BASE_ARGS = ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats"];
const sec = (t: number) => t.toFixed(6);

/** The sources a list of ranges reads, in order of first use. */
function sourcesUsed(items: FramedItem[]): string[] {
  return [...new Set(items.map((i) => i.sourceId))];
}

/**
 * Fits one kept range of `s` to the export. For 9:16 the crop is placed
 * around the speaker in that range (see framingAt), so it can move at a cut
 * but never during one.
 */
export function fitFilter(s: Source, item: Pick<FramedItem, "sourceStart" | "sourceEnd">, format: ExportFormat, size: Size): string {
  const { width: W, height: H } = size;
  if (format === "9:16") {
    // Fill the frame: crop to its shape around the speaker, then scale.
    const r = (W / H).toFixed(6);
    const x = cropOffset(framingAt(s, item.sourceStart, item.sourceEnd), sourceAspect(s), W / H).toFixed(4);
    return `crop=w='min(iw,ih*${r})':h='min(ih,iw/${r})':x='(iw-ow)*${x}':y='(ih-oh)/2',scale=${W}:${H}:flags=lanczos`;
  }
  // Fit inside the frame, letterboxed if the recording has another shape.
  return `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`;
}

const sourceAspect = (s: Source) => (s.media.width > 0 && s.media.height > 0 ? s.media.width / s.media.height : 16 / 9);

/** A stretch of a kept range to render as one branch: inside one punch-in, or outside all of them. */
type Piece = FramedItem & { punch: TimedPunch | null; at: number };

/**
 * Splits a chunk's ranges where punch-ins start and end, so each piece zooms
 * the same way throughout. `at` is the piece's first frame on the whole
 * output, which a zoom's progress is counted from.
 */
export function punchPieces(items: FramedItem[], punches: TimedPunch[], fps: number, speed: number): Piece[] {
  const step = frameStep(fps, speed);
  const marks = punches.map((p) => ({ p, a: Math.round(p.start * fps), b: Math.round(p.end * fps) }));
  const out: Piece[] = [];
  for (const item of items) {
    // A chunk's piece of a range keeps the range's own start; frames count on from there.
    const base = Math.round(item.outputStart * fps) - Math.round(item.sourceStart / step);
    const start = base + item.from;
    const end = start + item.frames;
    const cuts = [...new Set([start, end, ...marks.flatMap((m) => [m.a, m.b]).filter((f) => f > start && f < end)])].sort((x, y) => x - y);
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k]!;
      const b = cuts[k + 1]!;
      const punch = marks.find((m) => m.a <= a && b <= m.b)?.p ?? null;
      out.push({ ...item, from: item.from + (a - start), frames: b - a, punch, at: a });
    }
  }
  return out;
}

/** The zoom for one piece inside `punch`, applied to the fitted frame. */
export function punchFilter(s: Source, piece: Piece, punch: TimedPunch, size: Size, fps: number, rate: string): string {
  const { width: W, height: H } = size;
  const focus = punchFocus(s, [piece.sourceStart, piece.sourceEnd], punch.range, sourceAspect(s), W / H);
  const fx = focus.x.toFixed(4);
  const fy = focus.y.toFixed(4);
  const grown = (punch.scale - 1).toFixed(4);
  if (punch.style === "cut") {
    const z = punch.scale.toFixed(4);
    return `crop=w='trunc(iw/${z}/2)*2':h='trunc(ih/${z}/2)*2':x='(iw-ow)*${fx}':y='(ih-oh)*${fy}',scale=${W}:${H}:flags=lanczos`;
  }
  // Frames into the punch-in where this piece starts, and the zoom's length in frames.
  const into = piece.at - Math.round(punch.start * fps);
  const length = punch.style === "zoom-in" ? Math.max(1, Math.round(PUNCH.ramp * fps)) : Math.max(1, Math.round(punch.end * fps) - Math.round(punch.start * fps));
  const z = punch.style === "zoom-in" ? `1+${grown}*min(1,(${into}+on)/${length})` : `1+${grown}*(${into}+on)/${length}`;
  // A slow creep moves by fractions of a pixel a frame; working at twice the size keeps it from stepping.
  const up = punch.style === "slow-zoom" ? `scale=${W * 2}:${H * 2}:flags=bicubic,` : "";
  return `${up}zoompan=z='${z}':x='(iw-iw/zoom)*${fx}':y='(ih-ih/zoom)*${fy}':d=1:s=${W}x${H}:fps=${rate}`;
}

export type ChunkPlan = Shape & {
  chunk: Chunk;
  /** An ASS file and its fonts directory, relative to ffmpeg's working directory; null for no captions. */
  captions: { ass: string; fontsDir: string } | null;
  encoder: Encoder;
};

/**
 * The picture for one chunk, without sound. Each recording is read once from
 * just before its first range in the chunk, set to the frame grid (fps ÷ speed
 * in source time, so the speed change keeps every frame) and split into one
 * branch per range, cut by frame number.
 */
export function chunkCommand(plan: ChunkPlan): { graph: string; args: string[] } {
  const { chunk, fps, format, project } = plan;
  const size = exportSize(format, project.sources);
  const step = frameStep(fps, project.speed);
  const sources = new Map(project.sources.map((s) => [s.id, s]));
  const pieces = punchPieces(chunk.items, plan.punches ?? [], fps, project.speed);
  const used = sourcesUsed(pieces);
  // ffmpeg reads fps as a fraction: frames per source second.
  const rate = `${fps * 1000}/${Math.round(project.speed * 1000)}`;

  const args = [...BASE_ARGS];
  const lines: string[] = [];
  const first = new Map<string, number>();
  used.forEach((id, i) => {
    const mine = pieces.filter((x) => x.sourceId === id);
    const from = Math.min(...mine.map((x) => x.from));
    const to = Math.max(...mine.map((x) => x.from + x.frames));
    first.set(id, from);
    // Seeks to the first frame needed (decoding from the keyframe before it) and reads a little past the last.
    args.push("-ss", sec(from * step), "-t", sec((to - from) * step + 1), "-i", plan.inputs.get(id)!);
    const outs = mine.map((_, k) => `[s${i}v${k}]`).join("");
    lines.push(`[${i}:v:0]fps=fps=${rate}:start_time=0,split=${mine.length}${outs}`);
  });
  const taken = new Map<string, number>();
  const parts: string[] = [];
  pieces.forEach((item, k) => {
    const i = used.indexOf(item.sourceId);
    const b = taken.get(item.sourceId) ?? 0;
    taken.set(item.sourceId, b + 1);
    const a = item.from - first.get(item.sourceId)!;
    const source = sources.get(item.sourceId)!;
    const zoom = item.punch ? `,${punchFilter(source, item, item.punch, size, fps, rate)}` : "";
    const fit = `${fitFilter(source, item, format, size)}${zoom}`;
    lines.push(`[s${i}v${b}]trim=start_frame=${a}:end_frame=${a + item.frames},setpts=PTS-STARTPTS,${fit},setsar=1,format=yuv420p[v${k}]`);
    parts.push(`[v${k}]`);
  });
  lines.push(`${parts.join("")}concat=n=${parts.length}:v=1:a=0[cv]`);
  // Renumber the frames at the output rate; the speed change happens here.
  if (plan.captions) {
    // libass times each frame by its place in the whole video, so number from the chunk's start.
    lines.push(`[cv]settb=1/${fps},setpts=N+${chunk.start},ass=filename=${plan.captions.ass}:fontsdir=${plan.captions.fontsDir},setpts=N[outv]`);
  } else {
    lines.push(`[cv]settb=1/${fps},setpts=N[outv]`);
  }

  args.push(
    "-filter_complex_script", plan.graphFile,
    "-map", "[outv]", "-an",
    ...encoderArgs(plan.encoder, size.width * size.height >= 2560 * 1440 ? "16M" : "10M", true),
    "-r", String(fps),
    plan.out,
  );
  return { graph: `${lines.join(";\n")}\n`, args };
}

export type AudioPlan = Shape & { timeline: FramedTimeline };

/** The sound for the whole edit in one pass: every range cut by sample, joined, then sped up or slowed. */
export function audioCommand(plan: AudioPlan): { graph: string; args: string[] } {
  const { timeline, fps, project } = plan;
  const step = frameStep(fps, project.speed);
  const used = sourcesUsed(timeline.items);
  const args = [...BASE_ARGS];
  const lines: string[] = [];
  used.forEach((id, i) => {
    args.push("-i", plan.inputs.get(id)!);
    const n = timeline.items.filter((x) => x.sourceId === id).length;
    const outs = Array.from({ length: n }, (_, k) => `[s${i}a${k}]`).join("");
    lines.push(`[${i}:a:0]aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,asplit=${n}${outs}`);
  });
  const taken = new Map<string, number>();
  const parts: string[] = [];
  timeline.items.forEach((item, k) => {
    const i = used.indexOf(item.sourceId);
    const b = taken.get(item.sourceId) ?? 0;
    taken.set(item.sourceId, b + 1);
    const a = Math.round(item.from * step * SAMPLE_RATE);
    const e = Math.round((item.from + item.frames) * step * SAMPLE_RATE);
    lines.push(`[s${i}a${b}]atrim=start_sample=${a}:end_sample=${e},asetpts=PTS-STARTPTS[a${k}]`);
    parts.push(`[a${k}]`);
  });
  lines.push(`${parts.join("")}concat=n=${parts.length}:v=0:a=1${project.speed === 1 ? "[outa]" : `[ca];\n[ca]atempo=${project.speed}[outa]`}`);
  args.push("-filter_complex_script", plan.graphFile, "-map", "[outa]", "-vn", "-c:a", "aac", "-b:a", "192k", plan.out);
  return { graph: `${lines.join(";\n")}\n`, args };
}

/** The concat list for the chunks, relative to the folder it sits in. */
export const chunkList = (files: string[]) => `ffconcat version 1.0\n${files.map((f) => `file '${f}'`).join("\n")}\n`;

/** Joins the chunks and the sound without re-encoding, with the index up front for streaming. */
export function muxArgs(list: string, audio: string, out: string): string[] {
  return [
    ...BASE_ARGS,
    "-f", "concat", "-safe", "0", "-i", list,
    "-i", audio,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c", "copy",
    "-movflags", "+faststart",
    out,
  ];
}
