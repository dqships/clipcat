// The export, in pieces a long video can survive: the timeline snapped to
// whole output frames, the picture rendered in chunks of a few minutes (each
// seeking straight to its part of the recordings), the sound in one pass, and
// the two joined without re-encoding into an MP4 that starts playing before
// it has fully downloaded. Snapping every kept range to whole frames keeps the
// picture and the sound the same length piece by piece, so they stay in sync
// however many cuts there are.

import {
  MUSIC,
  PUNCH,
  type Project,
  type Source,
  type TimedOverlay,
  type Timeline,
  type TimelineItem,
  type TimedPunch,
  type TimedSound,
  cropOffset,
  framingAt,
  overlayBox,
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
  /** The b-roll in effect, timed the same way (see timedOverlays), and the file each one's media is read from. */
  overlays?: TimedOverlay[];
  overlayInputs?: Map<string, string>;
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

/** B-roll in one chunk: from frame `from` of the chunk for `frames` frames, starting `at` seconds into its media. */
export type ChunkOverlay = { overlay: TimedOverlay; from: number; frames: number; at: number };

/** The b-roll a chunk shows, cut to the chunk. A video (or a slide's) that runs out holds its last frame. */
export function chunkOverlays(chunk: Pick<Chunk, "start" | "frames">, overlays: TimedOverlay[], fps: number): ChunkOverlay[] {
  const out: ChunkOverlay[] = [];
  for (const o of overlays) {
    const a = Math.round(o.start * fps);
    const lo = Math.max(a, chunk.start);
    const hi = Math.min(Math.round(o.end * fps), chunk.start + chunk.frames);
    if (hi <= lo) continue;
    // Seeking right to the end finds no frame to hold, so the last half second is as far as it goes.
    const at = o.asset.kind !== "image" ? Math.max(0, Math.min(o.offset + (lo - a) / fps, o.asset.media.duration - 0.5)) : 0;
    out.push({ overlay: o, from: lo - chunk.start, frames: hi - lo, at });
  }
  return out;
}

/**
 * Fits b-roll to its place: covering the whole frame, or cropped to fill its
 * window, with the window's corners (or the whole circle) cut by an alpha
 * mask, anti-aliased by a pixel.
 */
export function overlayFit(o: TimedOverlay, size: Size): { filter: string; x: number; y: number } {
  const box = overlayBox(o, size);
  const cover = `scale=${box.width}:${box.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${box.width}:${box.height},setsar=1`;
  // A slide brings its own transparency, which the window's mask cuts further.
  const slide = o.asset.kind === "slide";
  if (o.placement === "full") return { filter: `${cover},format=${slide ? "yuva420p" : "yuv420p"}`, x: 0, y: 0 };
  const [hw, hh, r] = [box.width / 2, box.height / 2, box.radius];
  const inside = `${r}-hypot(max(abs(X+0.5-${hw})-${hw - r},0),max(abs(Y+0.5-${hh})-${hh - r},0))+0.5`;
  return { filter: `${cover},format=yuva420p,geq=lum='p(X,Y)':a='${slide ? "alpha(X,Y)" : "255"}*clip(${inside},0,1)'`, x: box.x, y: box.y };
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

  // B-roll goes over the picture, under the captions. Each is read for just its part of the chunk.
  const broll = chunkOverlays(chunk, plan.overlays ?? [], fps);
  let picture = "[cv]";
  if (broll.length > 0) {
    lines.push(`[cv]settb=1/${fps},setpts=N[b0]`);
    broll.forEach(({ overlay, from, frames, at }, k) => {
      const input = used.length + k;
      const file = plan.overlayInputs?.get(overlay.assetId);
      if (!file) throw new Error(`No file for b-roll ${overlay.asset.name}`);
      const seconds = sec(frames / fps + 1);
      if (overlay.asset.kind !== "image") args.push("-ss", sec(at), "-t", seconds, "-i", file);
      else args.push("-loop", "1", "-framerate", String(fps), "-t", seconds, "-i", file);
      const fit = overlayFit(overlay, size);
      // Numbered from its first frame in the chunk, so the overlay waits for it and lets the picture through after.
      lines.push(
        `[${input}:v:0]fps=fps=${fps},tpad=stop_mode=clone:stop=-1,trim=end_frame=${frames},setpts=PTS-STARTPTS,${fit.filter},settb=1/${fps},setpts=N+${from}[o${k}]`,
      );
      lines.push(`[b${k}][o${k}]overlay=x=${fit.x}:y=${fit.y}:eof_action=pass:format=auto[b${k + 1}]`);
    });
    picture = `[b${broll.length}]`;
  }

  // Renumber the frames at the output rate (the speed change happens here), unless the b-roll pass did.
  const retime = broll.length > 0 ? "" : `settb=1/${fps},`;
  if (plan.captions) {
    // libass times each frame by its place in the whole video, so number from the chunk's start.
    lines.push(`${picture}${retime}setpts=N+${chunk.start},ass=filename=${plan.captions.ass}:fontsdir=${plan.captions.fontsDir},setpts=N[outv]`);
  } else {
    lines.push(`${picture}${retime}setpts=N[outv]`);
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

export type AudioPlan = Shape & {
  timeline: FramedTimeline;
  /** Sound effects in play order (see timedSounds), with each effect's file and how far into it the sound lands. */
  sounds?: { cues: TimedSound[]; files: Map<string, string>; hits: Map<string, number> };
  /** Music under the whole video: the file, how loud, and whether it dips under speech. */
  music?: { file: string; volume: number; duck: boolean } | null;
};

/**
 * Lays the effects and music under the speech: each effect placed so the
 * sound lands on its moment, the music looped to the length, faded in and
 * out and (when asked) pressed down while someone speaks, all mixed at their
 * own levels and kept off the ceiling by a limiter. Only used when there
 * is one or the other, so speech alone is left untouched.
 */
function bedLines(plan: AudioPlan, args: string[], firstInput: number, speech: string): string[] {
  const cues = plan.sounds?.cues ?? [];
  const music = plan.music ?? null;
  const lines: string[] = [];
  const format = `aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`;
  const effects = [...new Set(cues.map((c) => c.effect))];
  const mix: string[] = [];
  let input = firstInput;
  const speechOut = music?.duck ? "[sp]" : speech;
  effects.forEach((effect, e) => {
    const file = plan.sounds!.files.get(effect);
    if (!file) throw new Error(`No file for the sound effect "${effect}"`);
    args.push("-i", file);
    const mine = cues.filter((c) => c.effect === effect);
    lines.push(`[${input++}:a:0]${format},asplit=${mine.length}${mine.map((_, k) => `[e${e}c${k}]`).join("")}`);
    mine.forEach((cue, k) => {
      // Placed so the hit (a whoosh's peak, a riser's end) falls on the word; one that would start before the video starts late into its file.
      const start = cue.time - (plan.sounds!.hits.get(effect) ?? 0);
      const skip = start < 0 ? `atrim=start=${sec(-start)},asetpts=PTS-STARTPTS,` : "";
      const delay = Math.round(Math.max(0, start) * 1000);
      lines.push(`[e${e}c${k}]${skip}volume=${cue.volume.toFixed(3)},adelay=${delay}:all=1[x${e}_${k}]`);
      mix.push(`[x${e}_${k}]`);
    });
  });
  if (music) {
    const d = plan.timeline.duration;
    args.push("-stream_loop", "-1", "-i", music.file);
    const fadeOut = Math.min(MUSIC.fadeOut, d / 2);
    lines.push(
      `[${input++}:a:0]${format},atrim=0:${sec(d)},asetpts=PTS-STARTPTS,afade=t=in:d=${Math.min(MUSIC.fadeIn, d / 2)},afade=t=out:st=${sec(d - fadeOut)}:d=${fadeOut},volume=${music.volume.toFixed(3)}[mus]`,
    );
    if (music.duck) {
      lines.push(`${speech}asplit=2[sp][key]`);
      lines.push("[mus][key]sidechaincompress=threshold=0.02:ratio=6:attack=30:release=400[bed]");
      mix.push("[bed]");
    } else {
      mix.push("[mus]");
    }
  }
  // The speech comes first, so the mix lasts exactly as long as it does.
  lines.push(`${speechOut}${mix.join("")}amix=inputs=${mix.length + 1}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95:level=false[outa]`);
  return lines;
}

/** The sound for the whole edit in one pass: every range cut by sample, joined, then sped up or slowed, with any effects and music laid under it. */
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
  const bed = (plan.sounds?.cues.length ?? 0) > 0 || plan.music;
  const speech = bed ? "[speech]" : "[outa]";
  lines.push(`${parts.join("")}concat=n=${parts.length}:v=0:a=1${project.speed === 1 ? speech : `[ca];\n[ca]atempo=${project.speed}${speech}`}`);
  if (bed) lines.push(...bedLines(plan, args, used.length, speech));
  args.push("-filter_complex_script", plan.graphFile, "-map", "[outa]", "-vn", "-c:a", "aac", "-b:a", "192k", plan.out);
  return { graph: `${lines.join(";\n")}\n`, args };
}

/** The concat list for the chunks, relative to the folder it sits in. */
export const chunkList = (files: string[]) => `ffconcat version 1.0\n${files.map((f) => `file '${f}'`).join("\n")}\n`;

/** Joins the chunks and the sound without re-encoding, with the index up front for streaming. */
export function muxArgs(list: string, audio: string, out: string, meta: string | null = null): string[] {
  return [
    ...BASE_ARGS,
    "-f", "concat", "-safe", "0", "-i", list,
    "-i", audio,
    ...(meta ? ["-f", "ffmetadata", "-i", meta, "-map_metadata", "2", "-map_chapters", "2"] : []),
    "-map", "0:v:0", "-map", "1:a:0",
    "-c", "copy",
    "-movflags", "+faststart",
    out,
  ];
}

/** Escapes what ffmetadata gives a meaning to: = ; # \ and line breaks. */
const metaText = (text: string) => text.replace(/[=;#\\\n]/g, (c) => `\\${c}`);

/**
 * The file's title and chapters as an ffmetadata file, each chapter running
 * to the next one (the last to the end), so players list them.
 */
export function ffmetadata(title: string, chapters: { start: number; title: string }[], duration: number): string {
  const ms = (t: number) => Math.round(t * 1000);
  const lines = [";FFMETADATA1"];
  if (title.trim()) lines.push(`title=${metaText(title.trim())}`);
  chapters.forEach((c, i) => {
    const end = i + 1 < chapters.length ? chapters[i + 1]!.start : duration;
    lines.push("[CHAPTER]", "TIMEBASE=1/1000", `START=${ms(c.start)}`, `END=${ms(end)}`, `title=${metaText(c.title)}`);
  });
  return `${lines.join("\n")}\n`;
}
