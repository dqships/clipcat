import { type Asset, type EditOp, type Project, type Proposal, SOUND_EFFECTS } from "@clipcat/core";
import { Check, X } from "lucide-react";
import type { ReactNode } from "react";
import { formatDuration } from "../format";
import { ICON_STROKE } from "../icons";

const TYPE_LABEL: Record<string, string> = { silence: "Silence", retake: "Retake", cleanup: "Filler words", tighten: "Tangent", "punch-in": "Zoom", visual: "B-roll", sound: "Sound" };
const LOOK_LABEL: Record<string, string> = { paper: "paper", ink: "ink", overlay: "over the video" };
const PLACEMENT_LABEL: Record<string, string> = { full: "full frame", pip: "picture in picture" };
const STYLE_LABEL: Record<string, string> = { cut: "jump", "zoom-in": "smooth", "slow-zoom": "slow" };
const EFFECT_NAME = new Map(SOUND_EFFECTS.map((e) => [e.id, e.name.toLowerCase()]));

type Props = {
  project: Project;
  onSeek: (sourceId: string, time: number) => void;
  onEdit: (op: EditOp) => void;
};

const length = (p: Proposal) => p.cuts.reduce((n, [a, b]) => n + (b - a), 0);

/** Made by the AI editor or the silence finder, not added by hand (those join with no reason). */
const suggested = (p: Proposal) => p.type === "silence" || p.reason !== "";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 cuts, 1 zoom, 3 b-roll, 1 slide and 2 sounds to review" */
function toReview(pending: Proposal[], slides: Set<string>): string {
  const punches = pending.filter((p) => p.punch).length;
  const slideCount = pending.filter((p) => p.overlay && slides.has(p.overlay.assetId)).length;
  const broll = pending.filter((p) => p.overlay).length - slideCount;
  const sounds = pending.filter((p) => p.sound).length;
  const cuts = pending.length - punches - broll - slideCount - sounds;
  const parts = [
    cuts > 0 && count(cuts, "cut", "cuts"),
    punches > 0 && count(punches, "zoom", "zooms"),
    broll > 0 && `${broll} b-roll`,
    slideCount > 0 && count(slideCount, "slide", "slides"),
    sounds > 0 && count(sounds, "sound", "sounds"),
  ].filter(Boolean);
  return `${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]} to review`;
}

/** "History: 4 accepted, 2 rejected" */
function history(decided: Proposal[]): string {
  const accepted = decided.filter((p) => p.status === "accepted").length;
  const rejected = decided.length - accepted;
  return `History: ${[accepted > 0 && `${accepted} accepted`, rejected > 0 && `${rejected} rejected`].filter(Boolean).join(", ")}`;
}

/**
 * The edits waiting on a decision: pauses, AI cuts, punch-ins, b-roll and
 * sound effects. Accepting a cut cuts its ranges, a punch-in zooms there,
 * b-roll shows there and an effect plays there; rejecting leaves the video as
 * it is. All can be undone. Decided ones stay in the history, where a
 * decision can be changed.
 */
export function Proposals({ project, onSeek, onEdit }: Props) {
  const pending = project.proposals.filter((p) => p.status === "pending");
  const media = new Map(project.assets.map((a) => [a.id, a.name]));
  const slides = new Map(project.assets.filter((a) => a.slide).map((a) => [a.id, a]));
  const text = new Map(project.transcript.map((w) => [w.id, w.text]));
  const decided = project.proposals.filter((p) => p.status !== "pending" && suggested(p));
  if (pending.length === 0 && decided.length === 0) return null;
  const what = (p: Proposal) => describe(p, media, slides, text);
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
            {pending.map((p) => (
              <Row key={p.id} p={p} what={what} onSeek={onSeek}>
                {(label) => (
                  <>
                    <button type="button" className="button button--icon" aria-label={`Accept ${label}`} onClick={() => decide([p.id], "accepted")}>
                      <Check className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                    </button>
                    <button type="button" className="button button--icon" aria-label={`Reject ${label}`} onClick={() => decide([p.id], "rejected")}>
                      <X className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                    </button>
                  </>
                )}
              </Row>
            ))}
          </ol>
        </>
      )}
      {decided.length > 0 && (
        <details className="history">
          <summary>{history(decided)}</summary>
          <ol className="proposals">
            {decided.map((p) => (
              <Row key={p.id} p={p} what={what} onSeek={onSeek} status={p.status === "accepted" ? "Accepted" : "Rejected"}>
                {(label) =>
                  p.status === "accepted" ? (
                    <button type="button" className="button button--icon" aria-label={`Reject ${label} instead`} title="Reject instead" onClick={() => decide([p.id], "rejected")}>
                      <X className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                    </button>
                  ) : (
                    <button type="button" className="button button--icon" aria-label={`Accept ${label} instead`} title="Accept instead" onClick={() => decide([p.id], "accepted")}>
                      <Check className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                    </button>
                  )
                }
              </Row>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

type Described = { label: string; type: string; reason: string; words: string };

/** What a suggestion is, in the words the list shows. */
function describe(p: Proposal, media: Map<string, string>, slides: Map<string, Asset>, text: Map<string, string>): Described {
  const words = p.wordIds.map((id) => text.get(id) ?? "").join(" ");
  const slide = p.overlay ? slides.get(p.overlay.assetId) : undefined;
  const label = slide ? "Slide" : (TYPE_LABEL[p.type] ?? p.type);
  const type = p.punch
    ? `${label}, ${STYLE_LABEL[p.punch.style]}`
    : slide?.slide
      ? `${label}, ${LOOK_LABEL[slide.slide.look]}${slide.slide.html ? "" : ", being designed"}: ${slide.name}`
      : p.overlay
        ? `${label}, ${media.get(p.overlay.assetId) ?? "media"}, ${PLACEMENT_LABEL[p.overlay.placement]}`
        : p.sound
          ? `${label}, ${EFFECT_NAME.get(p.sound.effect) ?? p.sound.effect}`
          : label;
  return { label, type, reason: p.reason || `${length(p).toFixed(1)} seconds of silence`, words };
}

type RowProps = {
  p: Proposal;
  what: (p: Proposal) => Described;
  onSeek: (sourceId: string, time: number) => void;
  /** For the history: what was decided. */
  status?: string;
  /** The row's buttons, given the suggestion's name for their labels. */
  children: (label: string) => ReactNode;
};

/** One suggestion: click it to play it, then its buttons. */
function Row({ p, what, onSeek, status, children }: RowProps) {
  const { label, type, reason, words } = what(p);
  return (
    <li className={status && p.status === "rejected" ? "proposal-row proposal-row--kept" : "proposal-row"}>
      <button type="button" className="proposal" onClick={() => onSeek(p.sourceId, p.punch?.range[0] ?? p.overlay?.range[0] ?? p.sound?.at ?? p.cuts[0]?.[0] ?? 0)}>
        <span className="proposal__type">
          {status && <span className={`proposal__status proposal__status--${p.status}`}>{status}: </span>}
          {type}
        </span>
        <span className="proposal__reason">{reason}</span>
        {words && <span className="proposal__words">“{words}”</span>}
      </button>
      {children(`${label.toLowerCase()}: ${p.reason || words || formatDuration(length(p))}`)}
    </li>
  );
}
