// Reads what a source file holds with ffprobe: duration, size, frame rate and
// codecs. Variable frame rate is flagged so prep renders a constant-rate proxy.

import { execFile } from "node:child_process";
import type { MediaInfo } from "@clipcat/core";

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
  disposition?: { attached_pic?: number };
};
type ProbeJson = { streams?: ProbeStream[]; format?: { duration?: string } };

export const PROBE_ARGS = ["-v", "error", "-print_format", "json", "-show_format", "-show_streams"];

const rate = (r: string | undefined): number => {
  if (!r) return 0;
  const [n, d] = r.split("/").map(Number);
  return n && d ? n / d : 0;
};

/** MediaInfo from ffprobe's JSON. Throws when the file has neither audio nor a duration. */
export function parseProbe(json: ProbeJson): MediaInfo {
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === "audio");
  const duration = Number(json.format?.duration ?? video?.duration ?? audio?.duration ?? 0);
  if (!audio) throw new Error("This file has no audio track, so there's nothing to transcribe.");
  if (!(duration > 0)) throw new Error("Couldn't read this file's duration.");
  const real = rate(video?.r_frame_rate);
  const avg = rate(video?.avg_frame_rate);
  return {
    duration,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: avg || real,
    vfr: video ? real > 0 && avg > 0 && Math.abs(real - avg) / real > 0.01 : false,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio.codec_name ?? null,
  };
}

/** How many sound streams a file has, and whether it has a picture (cover art doesn't count). */
export function streamCounts(json: ProbeJson): { audio: number; video: boolean } {
  const streams = json.streams ?? [];
  return {
    audio: streams.filter((s) => s.codec_type === "audio").length,
    video: streams.some((s) => s.codec_type === "video" && !s.disposition?.attached_pic),
  };
}

export function inspectStreams(ffprobe: string, file: string): Promise<{ audio: number; video: boolean }> {
  return new Promise((resolve, reject) => {
    execFile(ffprobe, [...PROBE_ARGS, file], { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`ffprobe couldn't read ${file}: ${stderr.trim() || error.message}`));
      resolve(streamCounts(JSON.parse(stdout) as ProbeJson));
    });
  });
}

export function probe(ffprobe: string, file: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    execFile(ffprobe, [...PROBE_ARGS, file], { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`ffprobe couldn't read ${file}: ${stderr.trim() || error.message}`));
      try {
        resolve(parseProbe(JSON.parse(stdout) as ProbeJson));
      } catch (e) {
        reject(e);
      }
    });
  });
}
