import { type EditOp, type OverlayPlacement, type PipCorner, type PipShape, type Project, buildTimeline, timedOverlays } from "@clipcat/core";
import { ImagePlus, RefreshCw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { bridge } from "../bridge";
import { formatDuration, mediaUrl } from "../format";
import { ICON_STROKE } from "../icons";

type Props = { project: Project; onSeek: (sourceId: string, time: number) => void; onEdit: (op: EditOp) => void };

const PLACEMENTS: { value: OverlayPlacement; label: string }[] = [
  { value: "full", label: "Full frame" },
  { value: "pip", label: "Picture in picture" },
];
const SHAPES: { value: PipShape; label: string }[] = [
  { value: "rectangle", label: "Rectangle" },
  { value: "square", label: "Square" },
  { value: "circle", label: "Circle" },
];
const CORNERS: { value: PipCorner; label: string }[] = [
  { value: "top-right", label: "Top right" },
  { value: "top-left", label: "Top left" },
  { value: "bottom-right", label: "Bottom right" },
  { value: "bottom-left", label: "Bottom left" },
];

/**
 * B-roll: the pictures and videos added to the project, with what each one
 * shows (the AI editor writes it, and it can be corrected), the slides the AI
 * editor designs, with what each says (a new brief has it designed again),
 * and the b-roll in the edit, in play order, with where and how each shows.
 * New b-roll comes from selecting words in the transcript, or from the AI
 * editor.
 */
export function MediaPanel({ project, onSeek, onEdit }: Props) {
  const [error, setError] = useState<string | null>(null);
  const timeline = useMemo(() => buildTimeline(project), [project]);
  const placed = useMemo(() => timedOverlays(project, timeline), [project, timeline]);

  const designAgain = async () => {
    setError(null);
    try {
      await bridge()?.invoke("project:design-slides", { id: project.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const add = async () => {
    setError(null);
    const b = bridge();
    if (!b) return;
    try {
      const files = await b.invoke("media:pick");
      if (files.length > 0) await b.invoke("project:add-media", { id: project.id, files });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="panel" aria-labelledby="media-title">
      <h2 id="media-title" className="section-title">
        B-roll
      </h2>
      <p className="project__summary">
        {project.assets.length === 0
          ? "Add pictures and clips to show over the speaker. The AI editor looks at each one and suggests where it fits."
          : "Select words in the transcript to show one over them, or run the AI editor for suggestions."}
      </p>
      <div>
        <button type="button" className="button" onClick={() => void add()}>
          <ImagePlus className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          Add pictures or clips
        </button>
      </div>
      {error && (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      )}
      {project.assets.length > 0 && (
        <ul className="media">
          {project.assets.map((a) => (
            <li key={a.id} className="media__item">
              {a.prep ? (
                <img className="media__thumb" src={mediaUrl(project.id, a.kind === "slide" ? a.prep.preview : a.prep.frames[0]!)} alt="" />
              ) : (
                <span className="media__thumb media__thumb--pending" />
              )}
              <div className="media__about">
                <span className="media__name">
                  {a.name}
                  <span className="media__kind">{a.kind === "video" ? formatDuration(a.media.duration) : a.kind === "slide" ? "Slide" : "Picture"}</span>
                  {a.slide && !a.slide.html && (
                    <button type="button" className="button" onClick={() => void designAgain()}>
                      <RefreshCw className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                      Design
                    </button>
                  )}
                </span>
                <textarea
                  key={a.description}
                  className="field__control media__description"
                  aria-label={a.slide ? `What ${a.name} says` : `What ${a.name} shows`}
                  placeholder={a.slide ? (a.slide.html ? "What the slide says" : "Being designed…") : a.prep ? "What it shows, for the AI editor" : "Preparing…"}
                  defaultValue={a.description}
                  rows={2}
                  maxLength={1000}
                  onBlur={(e) => {
                    if (e.target.value.trim() !== a.description) onEdit({ type: "describe", assetId: a.id, description: e.target.value });
                  }}
                />
              </div>
              <button type="button" className="button button--icon" aria-label={`Remove ${a.name}`} onClick={() => onEdit({ type: "remove-asset", assetId: a.id })}>
                <X className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {placed.length > 0 && (
        <ol className="punches">
          {placed.map((o) => {
            const at = formatDuration(o.start);
            const style = (patch: Omit<Extract<EditOp, { type: "overlay-style" }>, "type" | "id">) => onEdit({ type: "overlay-style", id: o.id, ...patch });
            return (
              <li key={o.id} className="punches__item punches__item--wrap">
                <button type="button" className="punches__where" onClick={() => onSeek(o.sourceId, o.range[0])}>
                  <span className="punches__time">{at}</span>
                  <span className="punches__words">{o.asset.name}</span>
                </button>
                <select
                  className="field__control"
                  aria-label={`Placement of the b-roll at ${at}`}
                  value={o.placement}
                  onChange={(e) => style({ placement: e.target.value as OverlayPlacement })}
                >
                  {PLACEMENTS.map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.label}
                    </option>
                  ))}
                </select>
                {o.placement === "pip" && (
                  <>
                    <select className="field__control" aria-label={`Shape of the b-roll at ${at}`} value={o.shape} onChange={(e) => style({ shape: e.target.value as PipShape })}>
                      {SHAPES.map((x) => (
                        <option key={x.value} value={x.value}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                    <select className="field__control" aria-label={`Corner of the b-roll at ${at}`} value={o.corner} onChange={(e) => style({ corner: e.target.value as PipCorner })}>
                      {CORNERS.map((x) => (
                        <option key={x.value} value={x.value}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <button
                  type="button"
                  className="button button--icon"
                  aria-label={`Remove the b-roll at ${at}`}
                  onClick={() => onEdit({ type: "decide", ids: [o.id], status: "rejected" })}
                >
                  <X className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
