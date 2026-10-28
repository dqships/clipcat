// The user's b-roll media: pictures and video clips, read with ffprobe and
// prepared for the editor. A video gets a light H.264 copy the preview can
// play (the export reads the original); a picture becomes a PNG, which both
// the preview and the export use, so any format ffmpeg reads works. Each
// also gets a few small frames for the AI editor to look at.

import { execFile } from "node:child_process";
import { extname } from "node:path";
import type { Asset } from "@clipcat/core";
import { type Encoder, encoderArgs } from "./encoders";
import { PROBE_ARGS } from "./probe";

export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "gif", "bmp", "tif", "tiff"];
export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "mkv", "webm", "avi"];

/** Frames a video shows the AI editor, spread across it. */
export const VIDEO_FRAMES = 3;
/** Wide enough to read a sign, small enough for an agent to take in twenty at once. */
const FRAME_WIDTH = 512;
const PREVIEW_HEIGHT = 720;
/** The largest picture kept: beyond any export size. */
const PICTURE_MAX = 2560;

export type AssetKind = Asset["kind"];
export type AssetMedia = Asset["media"];

export const assetKind = (file: string): AssetKind | null => {
  const ext = extname(file).slice(1).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext) ? "image" : VIDEO_EXTENSIONS.includes(ext) ? "video" : null;
};

type ProbeJson = {
  streams?: { codec_type?: string; width?: number; height?: number; duration?: string; disposition?: { attached_pic?: number } }[];
  format?: { duration?: string };
};

/** What a picture or video holds; throws when it has no picture. */
export function parseAssetProbe(json: ProbeJson, kind: AssetKind): AssetMedia {
  const video = (json.streams ?? []).find((s) => s.codec_type === "video" && (kind === "image" || !s.disposition?.attached_pic));
  if (!video?.width || !video.height) throw new Error(kind === "image" ? "Couldn't read this picture." : "This file has no video in it.");
  if (kind === "image") return { duration: 0, width: video.width, height: video.height };
  const duration = Number(json.format?.duration ?? video.duration ?? 0);
  if (!(duration > 0)) throw new Error("Couldn't read this video's duration.");
  return { duration, width: video.width, height: video.height };
}

export function probeAsset(ffprobe: string, file: string): Promise<{ kind: AssetKind; media: AssetMedia }> {
  const kind = assetKind(file);
  if (!kind) return Promise.reject(new Error("Add a picture (JPEG, PNG, WebP, HEIC) or a video (MP4, MOV, MKV, WebM)."));
  return new Promise((resolve, reject) => {
    execFile(ffprobe, [...PROBE_ARGS, file], { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`ffprobe couldn't read ${file}: ${stderr.trim() || error.message}`));
      try {
        resolve({ kind, media: parseAssetProbe(JSON.parse(stdout) as ProbeJson, kind) });
      } catch (e) {
        reject(e);
      }
    });
  });
}

const BASE = ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats"];

/** Where in a video its frames for the AI editor come from: the middle of each third. */
export const frameTimes = (duration: number) => Array.from({ length: VIDEO_FRAMES }, (_, i) => ((i + 0.5) * duration) / VIDEO_FRAMES);

/** The frames for the AI editor, in one pass: `frames` are the output paths. */
export function assetFrameArgs(input: string, kind: AssetKind, media: AssetMedia, frames: string[]): string[] {
  const scale = `scale=${FRAME_WIDTH}:${FRAME_WIDTH}:force_original_aspect_ratio=decrease,format=yuvj420p`;
  if (kind === "image") return [...BASE, "-i", input, "-frames:v", "1", "-vf", scale, "-q:v", "4", frames[0]!];
  const args = [...BASE];
  frameTimes(media.duration).forEach((t) => args.push("-ss", t.toFixed(3), "-i", input));
  frames.forEach((out, i) => args.push("-map", `${i}:v:0`, "-frames:v", "1", "-vf", scale, "-q:v", "4", out));
  return args;
}

/** The preview copy: a 720p, 30 fps H.264 video without sound, or a PNG no larger than PICTURE_MAX. */
export function assetPreviewArgs(input: string, kind: AssetKind, out: string, encoder: Encoder): string[] {
  if (kind === "image") {
    return [...BASE, "-i", input, "-frames:v", "1", "-vf", `scale=${PICTURE_MAX}:${PICTURE_MAX}:force_original_aspect_ratio=decrease:flags=lanczos`, out];
  }
  return [
    ...BASE,
    "-i", input,
    "-map", "0:v:0", "-an",
    "-vf", `fps=30,scale=-2:'2*trunc(min(${PREVIEW_HEIGHT},ih)/2)':flags=bilinear,format=yuv420p`,
    ...encoderArgs(encoder, "4M", false),
    "-g", "30",
    "-movflags", "+faststart",
    out,
  ];
}
