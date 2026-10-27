// Where the speaker is, for the vertical crop: frames sampled from the proxy
// every couple of seconds, faces found in each by the system's own face
// detector (see faces/detector.ts), and the speaker's centre kept for each.

import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { speakerX } from "@clipcat/core";
import type { JobContext } from "../jobs/queue";
import { runFfmpeg } from "./run";

/** Seconds between sampled frames: a cut is rarely shorter, and an hour is 1,800 frames. */
export const FACE_STEP = 2;
/** Tall enough for a face across the room, small enough to pass around quickly. */
const FRAME_HEIGHT = 360;
/** Frames handed to the detector at a time. */
const BATCH = 16;

/** A face, as fractions of the frame. */
export type FaceBox = { x: number; y: number; width: number; height: number };
/** Finds the faces in each JPEG; null where this system has no face detector. */
export type FaceDetector = (jpegs: Buffer[]) => Promise<FaceBox[][]>;

export function faceFrameArgs(proxy: string, pattern: string): string[] {
  return [
    "-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats",
    "-i", proxy,
    "-map", "0:v:0", "-an",
    // The first frame is at 0, then one every FACE_STEP seconds.
    "-vf", `fps=1/${FACE_STEP}:round=down,scale=-2:${FRAME_HEIGHT}`,
    "-q:v", "4",
    pattern,
  ];
}

export type FindFaces = { ffmpeg: string; proxy: string; duration: number; dir: string; detect: FaceDetector; ctx: JobContext };

/** The speaker's centre (0..1 across) at each sampled frame that has a face. The frames are deleted afterwards. */
export async function findFaces({ ffmpeg, proxy, duration, dir, detect, ctx }: FindFaces): Promise<{ t: number; x: number }[]> {
  const frames = join(dir, "faces");
  await rm(frames, { recursive: true, force: true });
  await mkdir(frames, { recursive: true });
  try {
    // Reading the proxy is the quick half; detection takes the rest of the bar.
    await runFfmpeg(ffmpeg, faceFrameArgs(proxy, join(frames, "f-%05d.jpg")), {
      duration,
      onProgress: (f) => ctx.progress(f * 0.3),
      signal: ctx.signal,
    });
    const names = (await readdir(frames)).filter((n) => n.endsWith(".jpg")).sort();
    const found: { t: number; x: number }[] = [];
    for (let i = 0; i < names.length; i += BATCH) {
      if (ctx.signal.aborted) throw new Error("cancelled");
      const batch = names.slice(i, i + BATCH);
      const faces = await detect(await Promise.all(batch.map((n) => readFile(join(frames, n)))));
      batch.forEach((name, k) => {
        const x = speakerX(faces[k] ?? []);
        // f-00001.jpg is the frame at 0 s.
        if (x !== null) found.push({ t: (Number(name.slice(2, 7)) - 1) * FACE_STEP, x: Math.round(x * 1000) / 1000 });
      });
      ctx.progress(0.3 + 0.7 * Math.min(1, (i + batch.length) / names.length));
    }
    return found;
  } finally {
    await rm(frames, { recursive: true, force: true });
  }
}
