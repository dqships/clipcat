import { type Project, applyCase, buildTimeline, captionCues, outputWords, sourceToOutput } from "@clipcat/core";
import { useMemo } from "react";
import type { Playhead } from "./Preview";

/** The landscape frame the preview stands in for; cue lengths follow the frame's shape. */
const PREVIEW_FRAME = { width: 1920, height: 1080 };

/**
 * The caption the export will burn in at the playhead, drawn over the
 * preview. Sizes are relative to the video's width, like libass scales them.
 */
export function CaptionOverlay({ project, playhead }: { project: Project; playhead: Playhead | null }) {
  const c = project.captions;
  const timeline = useMemo(() => buildTimeline(project), [project]);
  const cues = useMemo(
    () => (c.enabled ? captionCues(outputWords(project, timeline), c.mode, PREVIEW_FRAME) : []),
    [project, timeline, c.enabled, c.mode],
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
      // Size is in 1080p pixels; 1920 of them span the frame.
      style={{ top: `${c.position * 100}%`, fontSize: `calc(${c.size} / 1920 * 100cqw)`, color: c.color }}
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
