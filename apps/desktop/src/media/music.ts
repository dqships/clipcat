// The user's music: read with ffprobe, and copied to AAC for the preview to
// play (the export mixes the original, so any format ffmpeg reads works).

import { probe } from "./probe";

export const MUSIC_EXTENSIONS = ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "aif", "aiff"];

/** How long the music runs; throws when it has no sound. */
export async function probeMusic(ffprobe: string, file: string): Promise<number> {
  try {
    return (await probe(ffprobe, file)).duration;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(message.startsWith("This file has no audio") ? "This file has no sound in it." : message);
  }
}

const BASE = ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats"];

/** The preview copy: the first sound track as 48 kHz stereo AAC, with no picture. */
export const musicPrepArgs = (input: string, out: string): string[] => [
  ...BASE,
  "-i", input,
  "-map", "0:a:0", "-vn",
  "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-ar", "48000",
  "-movflags", "+faststart",
  out,
];
