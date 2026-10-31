import { type Project, buildTimeline } from "@clipcat/core";
import { FastForward, Pause, Play, Rewind, SkipBack, StepBack, StepForward } from "lucide-react";
import { type RefObject, useMemo } from "react";
import { formatTimecode } from "../format";
import { ICON_STROKE } from "../icons";
import { type Playhead, type PreviewHandle, type Transport, outputAt } from "./Preview";

type Props = {
  project: Project;
  playhead: Playhead | null;
  transport: Transport;
  preview: RefObject<PreviewHandle | null>;
};

/**
 * The preview's own controls: play from the beginning, shuttle back, a frame
 * back, play or pause, a frame on, shuttle forward, and where the playhead is
 * in the edit. Each button names its key (usePlaybackKeys).
 */
export function TransportBar({ project, playhead, transport, preview }: Props) {
  const timeline = useMemo(() => buildTimeline(project), [project]);
  const order = useMemo(() => new Map(project.sources.map((s) => [s.id, s.order])), [project.sources]);
  const at = playhead ? outputAt(timeline, playhead.sourceId, playhead.time, order) : 0;
  const playing = transport.rate !== 0;
  const fast = Math.abs(transport.rate) !== 1 || transport.rate < 0;
  const icon = { className: "icon-sm", strokeWidth: ICON_STROKE, "aria-hidden": true } as const;

  return (
    <div className="transport" role="toolbar" aria-label="Playback">
      <button
        type="button"
        className="button button--icon"
        title="Play from the beginning (Enter)"
        aria-label="Play from the beginning"
        disabled={timeline.items.length === 0}
        onClick={() => preview.current?.restart()}
      >
        <SkipBack {...icon} />
      </button>
      <button type="button" className="button button--icon" title="Play backwards, faster each press (J)" onClick={() => preview.current?.shuttle(-1)}>
        <Rewind {...icon} />
      </button>
      <button type="button" className="button button--icon" title="Back one frame (Left arrow)" onClick={() => preview.current?.step(-1)}>
        <StepBack {...icon} />
      </button>
      <button
        type="button"
        className="button button--icon"
        title={playing ? "Pause (Space or K)" : "Play (Space)"}
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => preview.current?.toggle()}
      >
        {playing ? <Pause {...icon} /> : <Play {...icon} />}
      </button>
      <button type="button" className="button button--icon" title="Forward one frame (Right arrow)" onClick={() => preview.current?.step(1)}>
        <StepForward {...icon} />
      </button>
      <button type="button" className="button button--icon" title="Play forwards, faster each press (L)" onClick={() => preview.current?.shuttle(1)}>
        <FastForward {...icon} />
      </button>
      <span className="transport__time">
        {formatTimecode(at)} / {formatTimecode(timeline.duration)}
      </span>
      {playing && fast && <span className="transport__rate">{transport.rate < 0 ? `−${-transport.rate}×` : `${transport.rate}×`}</span>}
    </div>
  );
}
