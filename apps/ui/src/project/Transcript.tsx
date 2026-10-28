import { type EditOp, type Project, SOUND_EFFECTS, type SlideLook, type Word, isWordKept, orderedWords } from "@clipcat/core";
import { AudioLines, Bookmark, Image, Presentation, Scissors, Undo2, ZoomIn } from "lucide-react";
import { useMemo, useState } from "react";
import { ICON_STROKE } from "../icons";
import type { Playhead } from "./Preview";

const LOOKS: { value: SlideLook; label: string }[] = [
  { value: "paper", label: "Paper" },
  { value: "ink", label: "Ink" },
  { value: "overlay", label: "Over the video" },
];

type Props = {
  project: Project;
  playhead: Playhead | null;
  onSeek: (sourceId: string, time: number) => void;
  onEdit: (op: EditOp) => void;
};

/**
 * The transcript as the edit: struck words are cut, and cutting words cuts
 * the video. Click a word to jump there, shift-click to select a run, then
 * Delete to cut it (or to restore it, when it is all cut already), zoom in on
 * it, show b-roll over it, have the AI editor
 * design a slide for it, or land a sound effect or start a chapter on its
 * first word.
 */
export function Transcript({ project, playhead, onSeek, onEdit }: Props) {
  const words = useMemo(() => orderedWords(project), [project]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const proposed = useMemo(
    // Only suggested cuts: a suggested zoom, b-roll or sound leaves its words in.
    () => new Set(project.proposals.filter((p) => p.cuts.length > 0 && p.type !== "silence" && p.status === "pending").flatMap((p) => p.wordIds)),
    [project.proposals],
  );
  const punched = useMemo(
    () => new Set(project.proposals.filter((p) => p.punch && p.status === "accepted").flatMap((p) => p.wordIds)),
    [project.proposals],
  );
  const covered = useMemo(
    () => new Set(project.proposals.filter((p) => p.overlay && p.status === "accepted").flatMap((p) => p.wordIds)),
    [project.proposals],
  );
  const chapterWords = useMemo(() => new Set(project.writeup?.chapters.map((c) => c.wordId)), [project.writeup]);
  const media = project.assets.filter((a) => a.prep && a.kind !== "slide");
  const [slide, setSlide] = useState<{ brief: string; look: SlideLook } | null>(null);
  const kept = useMemo(() => words.map((w) => isWordKept(project.segments, w)), [words, project.segments]);
  const names = new Map(project.sources.map((s) => [s.id, s.name]));
  const several = project.sources.length > 1;

  // A new transcript (another import, a re-run) invalidates index-based
  // selections, and the slide form belongs to the selection it was opened for.
  // Both reset while rendering rather than in an effect, so a click that lands
  // before a pending effect runs isn't undone by it.
  const [seen, setSeen] = useState({ length: words.length, anchor, focus });
  if (seen.length !== words.length) {
    setSeen({ length: words.length, anchor: null, focus: null });
    setAnchor(null);
    setFocus(null);
  } else if (seen.anchor !== anchor || seen.focus !== focus) {
    setSeen({ length: words.length, anchor, focus });
    setSlide(null);
  }

  const [from, to] = anchor === null || focus === null ? [-1, -2] : [Math.min(anchor, focus), Math.max(anchor, focus)];
  const selected = words.slice(from, to + 1);
  const allCut = selected.length > 0 && kept.slice(from, to + 1).every((k) => !k);
  const oneRecording = selected.every((w) => w.sourceId === selected[0]?.sourceId);
  const oneTake = oneRecording ? undefined : "Select words from one take to zoom in, or add b-roll or a slide";

  const apply = (included: boolean) => {
    if (selected.length === 0) return;
    onEdit({ type: "words", wordIds: selected.map((w) => w.id), included });
  };

  const current =
    playhead &&
    words.findIndex((w) => w.sourceId === playhead.sourceId && playhead.time >= w.start && playhead.time < w.end);

  return (
    <div
      className="editor"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setAnchor(null);
          setFocus(null);
        } else if ((e.key === "Delete" || e.key === "Backspace") && selected.length > 0) {
          e.preventDefault();
          apply(allCut);
        }
      }}
    >
      <div className="editor__actions" aria-live="polite">
        {selected.length > 0 ? (
          <>
            <span className="editor__count">
              {selected.length} {selected.length === 1 ? "word" : "words"} selected
            </span>
            {allCut ? (
              <button type="button" className="button" onClick={() => apply(true)}>
                <Undo2 className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                Restore
              </button>
            ) : (
              <>
                <button type="button" className="button" onClick={() => apply(false)}>
                  <Scissors className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                  Cut
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={!oneRecording}
                  title={oneTake}
                  onClick={() => onEdit({ type: "punch", wordIds: selected.map((w) => w.id), style: "zoom-in" })}
                >
                  <ZoomIn className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                  Zoom in
                </button>
                {!slide && (
                  <label className="editor__broll" title={oneTake ?? (media.length === 0 ? "Add pictures or clips in the B-roll section first" : undefined)}>
                    <Image className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                    <select
                      className="field__control"
                      aria-label="Show b-roll over the selection"
                      disabled={!oneRecording || media.length === 0}
                      value=""
                      onChange={(e) => {
                        if (e.target.value) onEdit({ type: "overlay", wordIds: selected.map((w) => w.id), assetId: e.target.value, placement: "full" });
                      }}
                    >
                      <option value="">B-roll…</option>
                      {media.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!slide && (
                  <button type="button" className="button" disabled={!oneRecording} title={oneTake} onClick={() => setSlide({ brief: "", look: "paper" })}>
                    <Presentation className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                    Slide
                  </button>
                )}
                {oneRecording && slide && (
                  <form
                    className="editor__slide"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!slide.brief.trim()) return;
                      onEdit({ type: "slide", wordIds: selected.map((w) => w.id), brief: slide.brief, look: slide.look });
                      setSlide(null);
                    }}
                  >
                    <input
                      className="field__control editor__brief"
                      aria-label="What the slide says"
                      placeholder="What the slide says"
                      value={slide.brief}
                      maxLength={1000}
                      autoFocus
                      onChange={(e) => setSlide({ ...slide, brief: e.target.value })}
                    />
                    <select className="field__control" aria-label="Slide look" value={slide.look} onChange={(e) => setSlide({ ...slide, look: e.target.value as SlideLook })}>
                      {LOOKS.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="button" disabled={!slide.brief.trim()}>
                      Add slide
                    </button>
                  </form>
                )}
                {!slide && !chapterWords.has(selected[0]?.id ?? "") && (
                  <button type="button" className="button" onClick={() => selected[0] && onEdit({ type: "chapter", wordId: selected[0].id, title: "New chapter" })}>
                    <Bookmark className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                    Chapter
                  </button>
                )}
                {!slide && (
                  <label className="editor__broll">
                    <AudioLines className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                    <select
                      className="field__control"
                      aria-label="Add a sound effect on the selection's first word"
                      value=""
                      onChange={(e) => {
                        if (e.target.value && selected[0]) onEdit({ type: "sound", wordId: selected[0].id, effect: e.target.value });
                      }}
                    >
                      <option value="">Sound…</option>
                      {SOUND_EFFECTS.map((effect) => (
                        <option key={effect.id} value={effect.id}>
                          {effect.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
          </>
        ) : (
          <span className="editor__count">
            Click a word to jump to it. Shift-click to select words, then cut them or add a zoom, b-roll, slide, chapter or sound.
          </span>
        )}
      </div>
      <p className="transcript">
        {words.map((w, i) => {
          const heading = several && (i === 0 || words[i - 1]!.sourceId !== w.sourceId);
          const classes = ["word"];
          if (!kept[i]) classes.push("word--cut");
          else if (proposed.has(w.id)) classes.push("word--proposed");
          if (kept[i] && punched.has(w.id)) classes.push("word--punched");
          if (kept[i] && covered.has(w.id)) classes.push("word--broll");
          if (i === current) classes.push("word--current");
          if (i >= from && i <= to) classes.push("word--selected");
          return (
            <span key={w.id}>
              {heading && <span className="transcript__source">{names.get(w.sourceId)}</span>}
              <button
                type="button"
                className={classes.join(" ")}
                aria-pressed={i >= from && i <= to}
                title={w.heard ? `Heard as “${w.heard}”` : undefined}
                onClick={(e) => {
                  if (e.shiftKey && anchor !== null) {
                    setFocus(i);
                  } else {
                    setAnchor(i);
                    setFocus(i);
                  }
                  onSeek(w.sourceId, w.start);
                }}
              >
                {w.text}
              </button>
            </span>
          );
        })}
      </p>
    </div>
  );
}
