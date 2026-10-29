import type { Project } from "@clipcat/core";
import { mediaUrl } from "../format";
import { fromStrip, keptParts, keptRanges, toStrip } from "./hiddenCuts";
import type { Playhead } from "./Preview";

type Props = {
  project: Project;
  playhead: Playhead | null;
  onSeek: (sourceId: string, time: number) => void;
  /** Closes the cuts up, so the strip shows only what's kept. */
  hideCuts?: boolean;
};

const pct = (t: number, duration: number) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`;

/**
 * One recording's waveform with its cuts shaded and pending suggestions
 * outlined. Click to jump. Shows the recording under the playhead. With the
 * cuts hidden, the kept stretches sit side by side and a seam marks each cut.
 */
export function Waveform({ project, playhead, onSeek, hideCuts = false }: Props) {
  const source = project.sources.find((s) => s.id === playhead?.sourceId) ?? [...project.sources].sort((a, b) => a.order - b.order)[0];
  if (!source?.prep) return null;
  const duration = source.media.duration || 1;
  const cuts = project.segments.filter((s) => s.sourceId === source.id && !s.included);
  const pending = project.proposals.filter((p) => p.sourceId === source.id && p.status === "pending").flatMap((p) => p.cuts.map((cut, i) => ({ key: `${p.id}-${i}`, cut })));
  const at = playhead?.sourceId === source.id ? playhead.time : null;
  const kept = hideCuts ? keptRanges(cuts, duration) : null;
  // Where a recording time sits on the strip, and back, 0 to 1.
  const place = (t: number) => (kept ? toStrip(kept, t) : t / duration);
  const timeAt = (x: number) => (kept ? fromStrip(kept, x) : x * duration);
  const span = (a: number, b: number) => ({ left: pct(place(a), 1), width: pct(place(b) - place(a), 1) });
  const image = mediaUrl(project.id, source.prep.waveform);

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
        if (box.width > 0) onSeek(source.id, timeAt((e.clientX - box.left) / box.width));
      }}
      onKeyDown={(e) => {
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        onSeek(source.id, Math.min(duration, Math.max(0, (at ?? 0) + step)));
      }}
    >
      {kept ? (
        // Each kept stretch shows its slice of the whole waveform: the image is
        // as wide as the recording would be at this scale, pulled left to the stretch.
        kept.map(([a, b], i) => (
          <span key={a} className={i > 0 ? "wave__piece wave__piece--seam" : "wave__piece"} style={span(a, b)}>
            <img className="wave__image wave__image--slice" src={image} alt="" draggable={false}
              style={{ width: `${(duration / (b - a)) * 100}%`, marginLeft: `-${(a / (b - a)) * 100}%` }}
              onError={(e) => {
                e.currentTarget.hidden = true;
              }}
            />
          </span>
        ))
      ) : (
        <img className="wave__image" src={image} alt=""
          draggable={false}
          onError={(e) => {
            e.currentTarget.hidden = true;
          }}
        />
      )}
      {pending.flatMap(({ key, cut }) =>
        (kept ? keptParts(kept, cut) : [cut]).map(([a, b], i) => <span key={`${key}-${i}`} className="wave__pending" style={span(a, b)} />),
      )}
      {!kept && cuts.map((s) => <span key={s.id} className="wave__cut" style={span(s.sourceStart, s.sourceEnd)} />)}
      {at !== null && <span className="wave__playhead" style={{ left: pct(place(at), 1) }} />}
    </div>
  );
}
