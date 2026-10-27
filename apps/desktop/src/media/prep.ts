// The one ffmpeg pass that prepares a source for editing: a light proxy the
// preview can scrub, 16 kHz mono WAV for transcription and silence, thumbnails
// and a waveform image. Audio-only files get a plain proxy frame so the rest
// of the app can treat every source as video.

import type { MediaInfo } from "@clipcat/core";

export type PrepOutputs = { proxy: string; wav: string; waveform: string; thumbs: string };
export type Encoder = "h264_videotoolbox" | "h264_mf" | "libx264";

export const PROXY_HEIGHT = 720;
export const THUMB_EVERY_SECONDS = 5;

/** The hardware H.264 encoder for this platform, with libx264 as the fallback. */
export function defaultEncoder(platform: NodeJS.Platform): Encoder {
  if (platform === "darwin") return "h264_videotoolbox";
  if (platform === "win32") return "h264_mf";
  return "libx264";
}

function encoderArgs(encoder: Encoder): string[] {
  switch (encoder) {
    case "h264_videotoolbox":
      return ["-c:v", "h264_videotoolbox", "-b:v", "6M", "-allow_sw", "1"];
    case "h264_mf":
      return ["-c:v", "h264_mf", "-b:v", "6M"];
    case "libx264":
      return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"];
  }
}

/**
 * ffmpeg arguments for the prep pass. `thumbs` is a printf pattern
 * (…/thumb-%04d.jpg). Progress goes to stdout as key=value lines.
 */
export function prepArgs(input: string, media: MediaInfo, out: PrepOutputs, encoder: Encoder): string[] {
  const hasVideo = media.videoCodec !== null && media.width > 0;
  const fps = media.fps > 0 ? Math.min(60, Math.round(media.fps)) : 30;
  const args = ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats"];

  if (hasVideo) {
    args.push("-i", input);
  } else {
    // Audio only: a still proxy frame keeps every source a video.
    args.push("-f", "lavfi", "-i", `color=c=black:s=1280x720:r=${fps}`, "-i", input);
  }
  const v = hasVideo ? "0:v:0" : "0:v";
  const a = hasVideo ? "0:a:0" : "1:a:0";
  // The waveform is drawn from the audio by a filter graph; its output is mapped below.
  args.push("-filter_complex", `[${a}]aformat=channel_layouts=mono,showwavespic=s=4000x120:colors=white[wave]`);

  // Proxy: constant frame rate, 720p, with audio, so preview and timings agree.
  args.push(
    "-map", v, "-map", a,
    "-vf", `fps=${fps},scale=-2:${PROXY_HEIGHT}:flags=bilinear,format=yuv420p`,
    ...encoderArgs(encoder),
    "-g", String(fps),
    "-c:a", "aac", "-b:a", "128k",
    ...(hasVideo ? [] : ["-shortest"]),
    "-movflags", "+faststart",
    out.proxy,
  );

  // Transcription and silence analysis audio.
  args.push("-map", a, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out.wav);

  // Thumbnails for the timeline strip.
  args.push("-map", v, "-an", "-vf", `fps=1/${THUMB_EVERY_SECONDS},scale=-2:180`, "-q:v", "5", out.thumbs);

  // Waveform for the timeline strip.
  args.push("-map", "[wave]", "-frames:v", "1", "-update", "1", out.waveform);
  return args;
}

/** Fraction done from one `-progress` block, given the source duration. */
export function progressFrom(line: string, duration: number): number | null {
  const m = /^out_time_us=(\d+)/.exec(line.trim());
  if (!m || duration <= 0) return null;
  return Math.min(1, Number(m[1]) / 1e6 / duration);
}
