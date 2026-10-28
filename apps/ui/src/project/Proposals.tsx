import { type EditOp, type Project, type Proposal, SOUND_EFFECTS } from "@clipcat/core";
import { Check, X } from "lucide-react";
import { formatDuration } from "../format";
import { ICON_STROKE } from "../icons";

const TYPE_LABEL: Record<string, string> = { silence: "Pause", retake: "Retake", cleanup: "Clean-up", tighten: "Tighten", "punch-in": "Punch-in", visual: "B-roll", sound: "Sound" };
const LOOK_LABEL: Record<string, string> = { paper: "paper", ink: "ink", overlay: "over the video" };
const PLACEMENT_LABEL: Record<string, string> = { full: "full frame", pip: "picture in picture" };
const STYLE_LABEL: Record<string, string> = { cut: "snap in", "zoom-in": "push in", "slow-zoom": "slow zoom" };
const EFFECT_NAME = new Map(SOUND_EFFECTS.map((e) => [e.id, e.name.toLowerCase()]));

type Props = {
  project: Project;
  onSeek: (sourceId: string, time: number) => void;
  onEdit: (op: EditOp) => void;
};

const length = (p: Proposal) => p.cuts.reduce((n, [a, b]) => n + (b - a), 0);

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 cuts, 1 punch-in, 3 b-roll, 1 slide and 2 sounds to review" */
function toReview(pending: Proposal[], slides: Set<string>): string {
  const punches = pending.filter((p) => p.punch).length;
  const slideCount = pending.filter((p) => p.overlay && slides.has(p.overlay.assetId)).length;
  const broll = pending.filter((p) => p.overlay).length - slideCount;
  const sounds = pending.filter((p) => p.sound).length;
  const cuts = pending.length - punches - broll - slideCount - sounds;
  const parts = [
    cuts > 0 && count(cuts, "cut", "cuts"),
    punches > 0 && count(punches, "punch-in", "punch-ins"),
    broll > 0 && `${broll} b-roll`,
    slideCount > 0 && count(slideCount, "slide", "slides"),
    sounds > 0 && count(sounds, "sound", "sounds"),
  ].filter(Boolean);
  return `${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]} to review`;
}

/**
 * The edits waiting on a decision: pauses, AI cuts, punch-ins, b-roll and
 * sound effects. Accepting a cut cuts its ranges, a punch-in zooms there,
 * b-roll shows there and an effect plays there; rejecting leaves the video as
 * it is. All can be undone.
 */
export function Proposals({ project, onSeek, onEdit }: Props) {
  const pending = project.proposals.filter((p) => p.status === "pending");
  // Accepted punch-ins, b-roll and sounds are listed in their own panels.
  const accepted = project.proposals.filter((p) => p.status === "accepted" && !p.punch && !p.overlay && !p.sound);
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
                  <button type="button" className="proposal" onClick={() => onSeek(p.sourceId, p.punch?.range[0] ?? p.overlay?.range[0] ?? p.sound?.at ?? p.cuts[0]?.[0] ?? 0)}>
                    <span className="proposal__type">
                      {p.punch
                        ? `${label}, ${STYLE_LABEL[p.punch.style]}`
                        : slide?.slide
                          ? `${label}, ${LOOK_LABEL[slide.slide.look]}${slide.slide.html ? "" : ", being designed"}: ${slide.name}`
                          : p.overlay
                            ? `${label}, ${media.get(p.overlay.assetId) ?? "media"}, ${PLACEMENT_LABEL[p.overlay.placement]}`
                            : p.sound
                              ? `${label}, ${EFFECT_NAME.get(p.sound.effect) ?? p.sound.effect}`
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
