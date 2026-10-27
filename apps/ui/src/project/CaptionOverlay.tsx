import { type Project, applyCase, buildTimeline, captionCues, captionPixels, outputWords, sourceToOutput } from "@clipcat/core";
import { useMemo } from "react";
import type { Playhead } from "./Preview";

/** The frames the preview stands in for; cue lengths and type size follow the frame's shape. */
const WIDE = { width: 1920, height: 1080 };
const TALL = { width: 1080, height: 1920 };

/**
 * The caption the export will burn in at the playhead, drawn over the
 * preview. Sizes are relative to the video's width, like libass scales them.
 */
export function CaptionOverlay({ project, playhead }: { project: Project; playhead: Playhead | null }) {
  const c = project.captions;
  const frame = project.aspectRatio === "9:16" ? TALL : WIDE;
  const timeline = useMemo(() => buildTimeline(project), [project]);
  const cues = useMemo(
    () => (c.enabled ? captionCues(outputWords(project, timeline), c.mode, frame) : []),
    [project, timeline, c.enabled, c.mode, frame],
  );
  if (!playhead || cues.length === 0) return null;
  const t = sourceToOutput(timeline, playhead.sourceId, playhead.time);
  if (t === null) return null;
  const cue = cues.find((x) => t >= x.start && t < x.end);
  if (!cue) return null;

  const classes = ["captions"];
  if (c.effect === "shadow") classes.push("captions--shadow");
  if (c.background === "rounded") classes.push("captions--box");
  return (
    <div
      className={classes.join(" ")}
      aria-hidden
      // The export's pixel size, as a share of the frame's width.
      style={{ top: `${c.position * 100}%`, fontSize: `calc(${captionPixels(c.size, frame)} / ${frame.width} * 100cqw)`, color: c.color }}
    >
      <span className="captions__line">
        {cue.words.map((w, i) => (
          <span key={`${w.start}-${i}`} className={c.mode === "word" && t >= w.start && (cue.words[i + 1]?.start ?? cue.end) > t ? "captions__word--now" : undefined}>
            {applyCase(w.text, c.case)}{" "}
          </span>
        ))}
      </span>
    </div>
  );
}
