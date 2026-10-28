import { type EditOp, type Project, type PunchStyle, buildTimeline, timedPunches } from "@clipcat/core";
import { X } from "lucide-react";
import { useMemo } from "react";
import { formatDuration } from "../format";
import { ICON_STROKE } from "../icons";

type Props = { project: Project; onSeek: (sourceId: string, time: number) => void; onEdit: (op: EditOp) => void };

const STYLES: { style: PunchStyle; label: string }[] = [
  { style: "cut", label: "Jump" },
  { style: "zoom-in", label: "Smooth" },
  { style: "slow-zoom", label: "Slow" },
];

/**
 * The punch-ins in the edit, in play order: where each one is, how it zooms,
 * and a way to take it out. New ones come from selecting words in the
 * transcript, or from the AI editor's suggestions.
 */
export function PunchInsPanel({ project, onSeek, onEdit }: Props) {
  const timeline = useMemo(() => buildTimeline(project), [project]);
  const punches = useMemo(() => timedPunches(project, timeline), [project, timeline]);
  const text = useMemo(() => new Map(project.transcript.map((w) => [w.id, w.text])), [project.transcript]);
  const byId = new Map(project.proposals.map((p) => [p.id, p]));
  if (punches.length === 0) return null;

  return (
    <section className="panel" aria-labelledby="punch-title">
      <h2 id="punch-title" className="section-title">
        Zooms
      </h2>
      <ol className="punches">
        {punches.map((p) => {
          const words = (byId.get(p.id)?.wordIds ?? []).map((id) => text.get(id) ?? "").join(" ");
          return (
            <li key={p.id} className="punches__item">
              <button type="button" className="punches__where" onClick={() => onSeek(p.sourceId, p.range[0])}>
                <span className="punches__time">{formatDuration(p.start)}</span>
                <span className="punches__words">{words ? `“${words}”` : `${(p.end - p.start).toFixed(1)} s`}</span>
              </button>
              <select
                className="field__control"
                aria-label={`How the zoom at ${formatDuration(p.start)} moves`}
                value={p.style}
                onChange={(e) => onEdit({ type: "punch-style", id: p.id, style: e.target.value as PunchStyle })}
              >
                {STYLES.map((s) => (
                  <option key={s.style} value={s.style}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button button--icon"
                aria-label={`Remove the zoom at ${formatDuration(p.start)}`}
                onClick={() => onEdit({ type: "decide", ids: [p.id], status: "rejected" })}
              >
                <X className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
