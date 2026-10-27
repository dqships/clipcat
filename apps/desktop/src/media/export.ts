// The export: one ffmpeg pass that cuts every kept range out of the original
// recordings, fits them to the output frame, joins them, applies the speed,
// burns in the captions with libass and encodes an MP4 that starts playing
// before it has fully downloaded.

import type { Project, Source, Timeline } from "@clipcat/core";
import type { Encoder } from "./prep";

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

function encoderArgs(encoder: Encoder, size: Size): string[] {
  const rate = size.width * size.height >= 2560 * 1440 ? "16M" : "10M";
  switch (encoder) {
    case "h264_videotoolbox":
      return ["-c:v", "h264_videotoolbox", "-b:v", rate, "-allow_sw", "1", "-profile:v", "high"];
    case "h264_mf":
      return ["-c:v", "h264_mf", "-b:v", rate];
    case "libx264":
      return ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high"];
  }
}

export type ExportPlan = {
  project: Pick<Project, "sources" | "speed">;
  timeline: Timeline;
  format: ExportFormat;
  /** The file each source is read from: the original, or the proxy for audio-only sources. */
  inputs: Map<string, string>;
  /** An ASS file and its fonts directory, relative to ffmpeg's working directory; null for no captions. */
  captions: { ass: string; fontsDir: string } | null;
  encoder: Encoder;
  /** The filter graph is written here (relative to the working directory) and read with -filter_complex_script. */
  graphFile: string;
  out: string;
};

/**
 * The filter graph and ffmpeg arguments for an export. Each source is read
 * once, set to a constant frame rate and split into one branch per kept
 * range, so the graph stays one decode per recording however many cuts.
 */
export function exportCommand(plan: ExportPlan): { graph: string; args: string[] } {
  const { timeline, format, project } = plan;
  if (timeline.items.length === 0) throw new Error("Nothing is left to export: every part of the video is cut.");
  const size = exportSize(format, project.sources);
  const fps = exportFps(project.sources);
  const used = [...new Set(timeline.items.map((i) => i.sourceId))];
  const inputIndex = new Map(used.map((id, i) => [id, i]));
  const sources = new Map(project.sources.map((s) => [s.id, s]));

  const fit = (s: Source) => {
    const { width: W, height: H } = size;
    if (format === "9:16") {
      // Fill the frame: crop to its shape around the speaker, then scale.
      const r = (W / H).toFixed(6);
      const x = Math.min(1, Math.max(0, s.frameX)).toFixed(4);
      return `crop=w='min(iw,ih*${r})':h='min(ih,iw/${r})':x='(iw-ow)*${x}':y='(ih-oh)/2',scale=${W}:${H}:flags=lanczos`;
    }
    // Fit inside the frame, letterboxed if the recording has another shape.
    return `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`;
  };

  const lines: string[] = [];
  const counts = new Map<string, number>();
  for (const item of timeline.items) counts.set(item.sourceId, (counts.get(item.sourceId) ?? 0) + 1);
  for (const id of used) {
    const i = inputIndex.get(id)!;
    const n = counts.get(id)!;
    const s = sources.get(id)!;
    const vOut = Array.from({ length: n }, (_, k) => `[s${i}v${k}]`).join("");
    const aOut = Array.from({ length: n }, (_, k) => `[s${i}a${k}]`).join("");
    lines.push(`[${i}:v:0]fps=${fps},${fit(s)},setsar=1,format=yuv420p,split=${n}${vOut}`);
    lines.push(`[${i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo,asplit=${n}${aOut}`);
  }
  const taken = new Map<string, number>();
  const pairs: string[] = [];
  timeline.items.forEach((item, k) => {
    const i = inputIndex.get(item.sourceId)!;
    const b = taken.get(item.sourceId) ?? 0;
    taken.set(item.sourceId, b + 1);
    const a = item.sourceStart.toFixed(6);
    const e = item.sourceEnd.toFixed(6);
    lines.push(`[s${i}v${b}]trim=start=${a}:end=${e},setpts=PTS-STARTPTS[v${k}]`);
    lines.push(`[s${i}a${b}]atrim=start=${a}:end=${e},asetpts=PTS-STARTPTS[a${k}]`);
    pairs.push(`[v${k}][a${k}]`);
  });
  lines.push(`${pairs.join("")}concat=n=${timeline.items.length}:v=1:a=1[cv][ca]`);

  let v = "[cv]";
  let a = "[ca]";
  if (project.speed !== 1) {
    lines.push(`${v}setpts=PTS/${project.speed}[sv]`, `${a}atempo=${project.speed}[sa]`);
    v = "[sv]";
    a = "[sa]";
  }
  if (plan.captions) {
    lines.push(`${v}ass=filename=${plan.captions.ass}:fontsdir=${plan.captions.fontsDir}[outv]`);
    v = "[outv]";
  }
  const graph = `${lines.join(";\n")}\n`;

  const args = ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats"];
  for (const id of used) args.push("-i", plan.inputs.get(id)!);
  args.push(
    "-filter_complex_script", plan.graphFile,
    "-map", v, "-map", a,
    ...encoderArgs(plan.encoder, size),
    "-r", String(fps),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    plan.out,
  );
  return { graph, args };
}
