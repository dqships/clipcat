// The H.264 encoders ClipCat can use, and how to pick one. macOS always has
// VideoToolbox. On Windows the GPU decides: NVIDIA (NVENC), Intel (Quick Sync)
// or AMD (AMF), else Media Foundation, so each is tried once on a tiny clip
// and the first that works is kept. libx264 always works and is the fallback
// whenever a hardware encoder fails partway.

export type Encoder = "h264_videotoolbox" | "h264_nvenc" | "h264_qsv" | "h264_amf" | "h264_mf" | "libx264";

/** Hardware encoders to try on each platform, best first. */
export function candidates(platform: NodeJS.Platform): Encoder[] {
  if (platform === "darwin") return ["h264_videotoolbox"];
  if (platform === "win32") return ["h264_nvenc", "h264_qsv", "h264_amf", "h264_mf"];
  return [];
}

/**
 * Encoder arguments at `bitrate`, including the pixel format each one takes.
 * `final` is the export (high profile, a slower x264 preset); otherwise the
 * edit proxy, where speed matters more.
 */
export function encoderArgs(encoder: Encoder, bitrate: string, final: boolean): string[] {
  const profile = final ? ["-profile:v", "high"] : [];
  switch (encoder) {
    case "h264_videotoolbox":
      return ["-c:v", encoder, "-b:v", bitrate, "-allow_sw", "1", ...profile, "-pix_fmt", "yuv420p"];
    case "h264_nvenc":
      return ["-c:v", encoder, "-preset", final ? "p5" : "p3", "-b:v", bitrate, ...profile, "-pix_fmt", "yuv420p"];
    case "h264_qsv":
      return ["-c:v", encoder, "-preset", final ? "medium" : "veryfast", "-b:v", bitrate, ...profile, "-pix_fmt", "nv12"];
    case "h264_amf":
      return ["-c:v", encoder, "-quality", final ? "quality" : "speed", "-b:v", bitrate, ...profile, "-pix_fmt", "yuv420p"];
    case "h264_mf":
      return ["-c:v", encoder, "-b:v", bitrate, "-pix_fmt", "nv12"];
    case "libx264":
      return final
        ? ["-c:v", encoder, "-preset", "medium", "-crf", "18", ...profile, "-pix_fmt", "yuv420p"]
        : ["-c:v", encoder, "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"];
  }
}

/** A fraction of a second of test picture through `encoder`, written nowhere. */
export function encoderTestArgs(encoder: Encoder): string[] {
  return [
    "-hide_banner", "-nostdin", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=0.3",
    ...encoderArgs(encoder, "2M", true),
    "-f", "null", "-",
  ];
}

/** The first candidate that encodes the test clip, or libx264. */
export async function pickEncoder(platform: NodeJS.Platform, works: (encoder: Encoder) => Promise<boolean>): Promise<Encoder> {
  for (const encoder of candidates(platform)) {
    if (await works(encoder).catch(() => false)) return encoder;
  }
  return "libx264";
}

/** Probes once, on first use, and remembers the answer. */
export function lazyEncoder(pick: () => Promise<Encoder>): () => Promise<Encoder> {
  let picked: Promise<Encoder> | null = null;
  return () => (picked ??= pick().catch(() => "libx264" as const));
}
