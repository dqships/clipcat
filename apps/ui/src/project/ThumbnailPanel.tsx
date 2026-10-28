import type { EditOp, Project, Thumbnail, ThumbnailBackground, ThumbnailColor } from "@clipcat/core";
import { Download, ImagePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";
import { formatDuration, mediaUrl } from "../format";
import { ICON_STROKE } from "../icons";
import type { ProjectJobs } from "../useJobs";
import type { Playhead } from "./Preview";
import { THUMBNAIL, type ThumbnailPictures, drawThumbnail, loadThumbnailFont } from "./thumbnail";

type Props = { project: Project; playhead: Playhead | null; jobs: ProjectJobs; onEdit: (op: EditOp) => void };

const COLORS: Record<ThumbnailColor, string> = { paper: "Paper", ink: "Ink", tape: "Tape yellow" };
const BACKGROUNDS: Record<ThumbnailBackground, string> = { frame: "The frame", blur: "The frame, blurred", paper: "Paper", ink: "Ink", tape: "Tape yellow" };

/** Loads a picture from the project's media so a canvas can draw it and still be saved. */
function picture(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn't load ${url}`));
    img.src = url;
  });
}

/**
 * The thumbnail: a frame from the video with its subject cut out, big text
 * behind them, and a background. The frame comes from wherever the playhead
 * is; the drawing here is what gets saved.
 */
export function ThumbnailPanel({ project, playhead, jobs, onEdit }: Props) {
  const t = project.thumbnail;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pictures, setPictures] = useState<ThumbnailPictures | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const running = jobs.active?.kind === "thumbnail";
  const text = draft ?? (t?.text || project.suggestedTitle);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  useEffect(() => {
    if (!t) return setPictures(null);
    let live = true;
    Promise.all([picture(mediaUrl(project.id, t.frame)), t.subject ? picture(mediaUrl(project.id, t.subject)) : null, loadThumbnailFont()])
      .then(([frame, subject]) => live && setPictures({ frame, subject }))
      .catch((e: unknown) => live && fail(e));
    return () => {
      live = false;
    };
  }, [project.id, t?.frame, t?.subject]);

  useEffect(() => {
    const g = canvas.current?.getContext("2d");
    if (g && pictures && t) drawThumbnail(g, pictures, t, text);
  }, [pictures, t, text]);

  const source = project.sources.find((s) => s.id === playhead?.sourceId) ?? [...project.sources].sort((a, b) => a.order - b.order)[0];
  const at = playhead && source?.id === playhead.sourceId ? playhead.time : 0;
  const pick = () => {
    if (!source) return;
    setError(null);
    bridge()?.invoke("project:thumbnail-frame", { id: project.id, sourceId: source.id, time: at }).catch(fail);
  };
  const save = () => {
    if (!canvas.current) return;
    setError(null);
    const png = canvas.current.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
    bridge()
      ?.invoke("project:save-thumbnail", { id: project.id, png })
      .then(({ path }) => setSaved(path))
      .catch(fail);
  };
  const style = (patch: Omit<Extract<EditOp, { type: "thumbnail" }>, "type">) => onEdit({ type: "thumbnail", ...patch });

  return (
    <section className="panel" aria-labelledby="thumbnail-title">
      <h2 id="thumbnail-title" className="section-title">
        Thumbnail
      </h2>
      <p className="project__summary">
        {!t
          ? "Pause on a frame where you look your best. ClipCat cuts you out of it so the text can sit behind you."
          : t.subject
            ? "The text sits behind you. Pick another frame any time; the text and colours stay."
            : running
              ? "Cutting you out of the frame…"
              : "Nothing in this frame stood out to cut out, so the text sits on top."}
      </p>
      <div>
        <button type="button" className="button" disabled={!source || running} onClick={pick}>
          <ImagePlus className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          {running ? "Making the thumbnail…" : `Make a thumbnail from ${formatDuration(at)}`}
        </button>
      </div>
      {error && (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      )}
      {t && (
        <>
          <canvas ref={canvas} className="thumbnail__canvas" width={THUMBNAIL.width} height={THUMBNAIL.height} aria-label="Thumbnail preview" role="img" />
          <label className="field">
            <span className="field__label">Text</span>
            <input
              className="field__control"
              value={text}
              maxLength={80}
              placeholder="A few big words"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (draft !== null && draft !== t.text) style({ text: draft });
                setDraft(null);
              }}
            />
          </label>
          <label className="field">
            <span className="field__label">Text colour</span>
            <select className="field__control" value={t.textColor} onChange={(e) => style({ textColor: e.target.value as ThumbnailColor })}>
              {Object.entries(COLORS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Behind the text</span>
            <select className="field__control" value={t.background} onChange={(e) => style({ background: e.target.value as ThumbnailBackground })}>
              {Object.entries(BACKGROUNDS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Text side</span>
            <select className="field__control" value={t.textSide} onChange={(e) => style({ textSide: e.target.value as Thumbnail["textSide"] })}>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label className="field field--inline">
            <input type="checkbox" checked={t.behind} disabled={!t.subject} onChange={(e) => style({ behind: e.target.checked })} />
            Put the text behind you
          </label>
          <div>
            <button type="button" className="button" disabled={!pictures} onClick={save}>
              <Download className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              Save thumbnail as PNG…
            </button>
          </div>
          {saved && <p className="project__summary">Saved to {saved}.</p>}
        </>
      )}
    </section>
  );
}
