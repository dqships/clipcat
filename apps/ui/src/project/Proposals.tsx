import type { EditOp, Project, Proposal } from "@clipcat/core";
import { Check, X } from "lucide-react";
import { formatDuration } from "../format";
import { ICON_STROKE } from "../icons";

const TYPE_LABEL: Record<string, string> = { silence: "Pause", retake: "Retake", cleanup: "Clean-up", tighten: "Tighten", "punch-in": "Punch-in", visual: "B-roll" };
const LOOK_LABEL: Record<string, string> = { paper: "paper", ink: "ink", overlay: "over the video" };
const PLACEMENT_LABEL: Record<string, string> = { full: "full frame", pip: "picture in picture" };
const STYLE_LABEL: Record<string, string> = { cut: "snap in", "zoom-in": "push in", "slow-zoom": "slow zoom" };

type Props = {
  project: Project;
  onSeek: (sourceId: string, time: number) => void;
  onEdit: (op: EditOp) => void;
};

const length = (p: Proposal) => p.cuts.reduce((n, [a, b]) => n + (b - a), 0);

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 cuts, 1 punch-in, 3 b-roll and 1 slide to review" */
function toReview(pending: Proposal[], slides: Set<string>): string {
  const punches = pending.filter((p) => p.punch).length;
  const slideCount = pending.filter((p) => p.overlay && slides.has(p.overlay.assetId)).length;
  const broll = pending.filter((p) => p.overlay).length - slideCount;
  const cuts = pending.length - punches - broll - slideCount;
  const parts = [
    cuts > 0 && count(cuts, "cut", "cuts"),
    punches > 0 && count(punches, "punch-in", "punch-ins"),
    broll > 0 && `${broll} b-roll`,
    slideCount > 0 && count(slideCount, "slide", "slides"),
  ].filter(Boolean);
  return `${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]} to review`;
}

/**
 * The edits waiting on a decision: pauses, AI cuts, punch-ins and b-roll.
 * Accepting a cut cuts its ranges, a punch-in zooms there and b-roll shows
 * there; rejecting leaves the video as it is. All can be undone.
 */
export function Proposals({ project, onSeek, onEdit }: Props) {
  const pending = project.proposals.filter((p) => p.status === "pending");
  // Accepted punch-ins and b-roll are listed in their own panels.
  const accepted = project.proposals.filter((p) => p.status === "accepted" && !p.punch && !p.overlay);
  const media = new Map(project.assets.map((a) => [a.id, a.name]));
  const slides = new Map(project.assets.filter((a) => a.slide).map((a) => [a.id, a]));
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
          ? `${toReview(pending, new Set(slides.keys()))}${seconds > 0 ? `, ${formatDuration(seconds)} in all.` : "."}`
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
              const slide = p.overlay ? slides.get(p.overlay.assetId) : undefined;
              const label = slide ? "Slide" : (TYPE_LABEL[p.type] ?? p.type);
              return (
                <li key={p.id} className="proposal-row">
                  <button type="button" className="proposal" onClick={() => onSeek(p.sourceId, p.punch?.range[0] ?? p.overlay?.range[0] ?? p.cuts[0]?.[0] ?? 0)}>
                    <span className="proposal__type">
                      {p.punch
                        ? `${label}, ${STYLE_LABEL[p.punch.style]}`
                        : slide?.slide
                          ? `${label}, ${LOOK_LABEL[slide.slide.look]}${slide.slide.html ? "" : ", being designed"}: ${slide.name}`
                          : p.overlay
                            ? `${label}, ${media.get(p.overlay.assetId) ?? "media"}, ${PLACEMENT_LABEL[p.overlay.placement]}`
                            : label}
                    </span>
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
