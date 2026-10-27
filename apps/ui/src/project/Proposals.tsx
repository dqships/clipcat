import type { EditOp, Project, Proposal } from "@clipcat/core";
import { Check, X } from "lucide-react";
import { formatDuration } from "../format";
import { ICON_STROKE } from "../icons";

const TYPE_LABEL: Record<string, string> = { silence: "Pause", retake: "Retake", cleanup: "Clean-up", tighten: "Tighten", "punch-in": "Punch-in" };
const STYLE_LABEL: Record<string, string> = { cut: "snap in", "zoom-in": "push in", "slow-zoom": "slow zoom" };

type Props = {
  project: Project;
  onSeek: (sourceId: string, time: number) => void;
  onEdit: (op: EditOp) => void;
};

const length = (p: Proposal) => p.cuts.reduce((n, [a, b]) => n + (b - a), 0);

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 cuts and 1 punch-in to review" */
function toReview(pending: Proposal[]): string {
  const punches = pending.filter((p) => p.punch).length;
  const cuts = pending.length - punches;
  const parts = [cuts > 0 && count(cuts, "cut", "cuts"), punches > 0 && count(punches, "punch-in", "punch-ins")].filter(Boolean);
  return `${parts.join(" and ")} to review`;
}

/**
 * The edits waiting on a decision: pauses, AI cuts and punch-ins. Accepting a
 * cut cuts its ranges, and accepting a punch-in zooms there; rejecting leaves
 * the video as it is. Both can be undone.
 */
export function Proposals({ project, onSeek, onEdit }: Props) {
  const pending = project.proposals.filter((p) => p.status === "pending");
  // Accepted punch-ins are listed with the other punch-ins.
  const accepted = project.proposals.filter((p) => p.status === "accepted" && !p.punch);
  const text = new Map(project.transcript.map((w) => [w.id, w.text]));
  if (pending.length === 0 && accepted.length === 0) return null;
  const seconds = pending.reduce((n, p) => n + length(p), 0);
  const decide = (ids: string[], status: "accepted" | "rejected") => ids.length > 0 && onEdit({ type: "decide", ids, status });

  return (
    <section className="review" aria-labelledby="review-title">
      <h2 id="review-title" className="section-title">
        Suggested edits
      </h2>
      <p className="project__summary">
        {pending.length > 0
          ? `${toReview(pending)}${seconds > 0 ? `, ${formatDuration(seconds)} in all.` : "."}`
          : "Nothing left to review."}
        {accepted.length > 0 && ` ${accepted.length} accepted.`}
      </p>
      {pending.length > 0 && (
        <>
          <div className="review__actions">
            <button type="button" className="button" onClick={() => decide(pending.map((p) => p.id), "accepted")}>
              Accept all
            </button>
            <button type="button" className="button" onClick={() => decide(pending.map((p) => p.id), "rejected")}>
              Reject all
            </button>
          </div>
          <ol className="proposals">
            {pending.map((p) => {
              const words = p.wordIds.map((id) => text.get(id) ?? "").join(" ");
              const label = TYPE_LABEL[p.type] ?? p.type;
              return (
                <li key={p.id} className="proposal-row">
                  <button type="button" className="proposal" onClick={() => onSeek(p.sourceId, p.punch?.range[0] ?? p.cuts[0]?.[0] ?? 0)}>
                    <span className="proposal__type">{p.punch ? `${label}, ${STYLE_LABEL[p.punch.style]}` : label}</span>
                    <span className="proposal__reason">{p.reason || `${length(p).toFixed(1)} seconds of silence`}</span>
                    {words && <span className="proposal__words">“{words}”</span>}
                  </button>
                  <button
                    type="button"
                    className="button button--icon"
                    aria-label={`Accept ${label.toLowerCase()}: ${p.reason || words || formatDuration(length(p))}`}
                    onClick={() => decide([p.id], "accepted")}
                  >
                    <Check className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="button button--icon"
                    aria-label={`Reject ${label.toLowerCase()}: ${p.reason || words || formatDuration(length(p))}`}
                    onClick={() => decide([p.id], "rejected")}
                  >
                    <X className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
