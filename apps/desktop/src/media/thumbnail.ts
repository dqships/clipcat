// The thumbnail's frame: one picture from the original recording (not the
// proxy, so it is as sharp as the camera made it), at most 1920×1080.

/** The size the thumbnail is made at, YouTube's recommended one. */
export const THUMBNAIL_SIZE = { width: 1280, height: 720 };

/** A JPEG of the frame at `time` seconds, scaled down to fit 1920×1080 if it is bigger. */
export const thumbnailFrameArgs = (input: string, time: number, out: string): string[] => [
  "-hide_banner", "-nostdin", "-y",
  "-ss", time.toFixed(3),
  "-i", input,
  "-frames:v", "1",
  "-vf", "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease",
  "-q:v", "2",
  out,
];
