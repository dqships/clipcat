// Small builders for tests.
import type { Source, Word } from "./project";

export const counter = (prefix = "id") => {
  let n = 0;
  return () => `${prefix}${++n}`;
};

export function source(id: string, duration: number, order = 0): Source {
  return {
    id,
    name: id,
    path: `/videos/${id}.mov`,
    order,
    media: { duration, width: 1920, height: 1080, fps: 30, vfr: false, videoCodec: "h264", audioCodec: "aac" },
    frameX: 0.5,
    framing: "auto",
    faces: null,
    prep: null,
    transcription: null,
    silenceRanges: [],
  };
}

/** Words of `text` at 0.5 s each with 0.1 s gaps, starting at `at`. */
export function words(sourceId: string, text: string, at = 0): Word[] {
  return text.split(" ").map((t, i) => ({
    id: `${sourceId}-w${i}`,
    sourceId,
    text: t,
    start: at + i * 0.6,
    end: at + i * 0.6 + 0.5,
  }));
}
