import type { EditOp, Project, Thumbnail, ThumbnailBackground, ThumbnailColor } from "@clipcat/core";
import { Download, ImagePlus, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";
import { formatDuration, mediaUrl } from "../format";
import { ICON_STROKE } from "../icons";
import type { ProjectJobs } from "../useJobs";
import type { Playhead } from "./Preview";
import { type Box, type ThumbnailPictures, clampBox, drawThumbnail, loadThumbnailFont, thumbnailSize, thumbnailTextBox } from "./thumbnail";

type Props = { project: Project; playhead: Playhead | null; jobs: ProjectJobs; onEdit: (op: EditOp) => void };

const COLORS: Record<ThumbnailColor, string> = {
  paper: "Paper",
  ink: "Ink",
  tape: "Tape yellow",
  red: "Red",
  orange: "Orange",
  lime: "Lime",
  green: "Green",
  sky: "Sky blue",
  blue: "Blue",
  pink: "Pink",
  violet: "Violet",
};
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

/** How far an arrow key moves or resizes the text, as a share of the thumbnail; with Shift, five times as far. */
const NUDGE = 0.01;

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

type TextBoxProps = { box: Box; onMove: (box: Box) => void; onDone: (box: Box) => void };

/**
 * The text's box over the preview: drag it to move the text, drag its
 * corner to resize it. Arrow keys do the same on the box and on the corner.
 */
function TextBox({ box, onMove, onDone }: TextBoxProps) {
  const drag = useRef<{ mode: "move" | "resize"; x: number; y: number; from: Box; stage: DOMRect; last: Box } | null>(null);
  const start = (mode: "move" | "resize") => (e: React.PointerEvent<HTMLElement>) => {
    const stage = e.currentTarget.closest(".thumbnail__stage")?.getBoundingClientRect();
    if (!stage || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, from: box, stage, last: box };
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / d.stage.width;
    const dy = (e.clientY - d.y) / d.stage.height;
    const { from } = d;
    d.last = clampBox(d.mode === "move" ? { ...from, x: from.x + dx, y: from.y + dy } : { ...from, width: Math.min(1 - from.x, from.width + dx), height: Math.min(1 - from.y, from.height + dy) });
    onMove(d.last);
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.last !== d.from) onDone(d.last);
  };
  const key = (mode: "move" | "resize") => (e: React.KeyboardEvent<HTMLElement>) => {
    const arrow = ARROWS[e.key];
    if (!arrow) return;
    e.preventDefault();
    e.stopPropagation();
    const [dx, dy] = arrow.map((a) => a * NUDGE * (e.shiftKey ? 5 : 1)) as [number, number];
    onDone(clampBox(mode === "move" ? { ...box, x: box.x + dx, y: box.y + dy } : { ...box, width: Math.min(1 - box.x, box.width + dx), height: Math.min(1 - box.y, box.height + dy) }));
  };
  const pct = (n: number) => `${n * 100}%`;
  return (
    <div
      className="thumbnail__text"
      style={{ left: pct(box.x), top: pct(box.y), width: pct(box.width), height: pct(box.height) }}
      role="button"
      tabIndex={0}
      aria-label="Move the text: drag it, or use the arrow keys"
      onPointerDown={start("move")}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={key("move")}
    >
      <span
        className="thumbnail__handle"
        role="button"
        tabIndex={0}
        aria-label="Resize the text: drag the corner, or use the arrow keys"
        onPointerDown={start("resize")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={key("resize")}
      />
    </div>
  );
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
  /** The text's box while it's being dragged, until the project has it. */
  const [moving, setMoving] = useState<Box | null>(null);
  const size = thumbnailSize(project.aspectRatio);
  const tall = size.height > size.width;
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

  useEffect(() => setMoving(null), [t?.textBox]);

  useEffect(() => {
    const g = canvas.current?.getContext("2d");
    if (g && pictures && t) drawThumbnail(g, pictures, { ...project, thumbnail: moving ? { ...t, textBox: moving } : t }, text);
  }, [pictures, t, text, moving, project.aspectRatio, project.sources]);

  const shown = (() => {
    if (moving) return moving;
    if (!t) return null;
    const b = thumbnailTextBox(t, size);
    return { x: b.x / size.width, y: b.y / size.height, width: b.width / size.width, height: b.height / size.height };
  })();

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
          <div className={tall ? "thumbnail__stage thumbnail__stage--tall" : "thumbnail__stage"}>
            <canvas ref={canvas} className="thumbnail__canvas" width={size.width} height={size.height} aria-label="Thumbnail preview" role="img" />
            {pictures && shown && (
              <TextBox
                box={shown}
                onMove={setMoving}
                onDone={(b) => {
                  setMoving(b);
                  style({ textBox: b });
                }}
              />
            )}
          </div>
          <p className="project__summary">Drag the text to move it, or its corner to make it bigger or smaller.</p>
          {t.textBox && (
            <div>
              <button type="button" className="button" onClick={() => style({ textBox: null })}>
                <Undo2 className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                Put the text back
              </button>
            </div>
          )}
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
            <select className="field__control" value={t.textSide} onChange={(e) => style({ textSide: e.target.value as Thumbnail["textSide"], textBox: null })}>
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
