import type { Project } from "@clipcat/core";
import { mediaUrl } from "../format";
import type { Playhead } from "./Preview";

type Props = {
  project: Project;
  playhead: Playhead | null;
  onSeek: (sourceId: string, time: number) => void;
};

const pct = (t: number, duration: number) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`;

/**
 * One recording's waveform with its cuts shaded and pending suggestions
 * outlined. Click to jump. Shows the recording under the playhead.
 */
export function Waveform({ project, playhead, onSeek }: Props) {
  const source = project.sources.find((s) => s.id === playhead?.sourceId) ?? [...project.sources].sort((a, b) => a.order - b.order)[0];
  if (!source?.prep) return null;
  const duration = source.media.duration || 1;
  const cuts = project.segments.filter((s) => s.sourceId === source.id && !s.included);
  const pending = project.proposals.filter((p) => p.sourceId === source.id && p.status === "pending").flatMap((p) => p.cuts.map((cut, i) => ({ key: `${p.id}-${i}`, cut })));
  const at = playhead?.sourceId === source.id ? playhead.time : null;

  return (
    <div
      className="wave"
      role="slider"
      tabIndex={0}
      aria-label={`Position in ${source.name}`}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(at ?? 0)}
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        if (box.width > 0) onSeek(source.id, ((e.clientX - box.left) / box.width) * duration);
      }}
      onKeyDown={(e) => {
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        onSeek(source.id, Math.min(duration, Math.max(0, (at ?? 0) + step)));
      }}
    >
      <img className="wave__image" src={mediaUrl(project.id, source.prep.waveform)} alt=""
        draggable={false}
        onError={(e) => {
          e.currentTarget.hidden = true;
        }}
      />
      {pending.map(({ key, cut: [a, b] }) => (
        <span key={key} className="wave__pending" style={{ left: pct(a, duration), width: pct(b - a, duration) }} />
      ))}
      {cuts.map((s) => (
        <span key={s.id} className="wave__cut" style={{ left: pct(s.sourceStart, duration), width: pct(s.sourceEnd - s.sourceStart, duration) }} />
      ))}
      {at !== null && <span className="wave__playhead" style={{ left: pct(at, duration) }} />}
    </div>
  );
}
