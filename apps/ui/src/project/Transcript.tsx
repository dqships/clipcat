import { type EditOp, type Project, type Word, isWordKept } from "@clipcat/core";
import { Scissors, Undo2, ZoomIn } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ICON_STROKE } from "../icons";
import type { Playhead } from "./Preview";

type Props = {
  project: Project;
  playhead: Playhead | null;
  onSeek: (sourceId: string, time: number) => void;
  onEdit: (op: EditOp) => void;
};

/** Every word in play order: recordings by their order, words by time. */
export function orderedWords(project: Project): Word[] {
  const order = new Map(project.sources.map((s) => [s.id, s.order]));
  return [...project.transcript].sort((a, b) => (order.get(a.sourceId) ?? 0) - (order.get(b.sourceId) ?? 0) || a.start - b.start);
}

/**
 * The transcript as the edit: struck words are cut, and cutting words cuts
 * the video. Click a word to jump there, shift-click to select a run, then
 * Delete to cut it (or to restore it, when it is all cut already), or punch in
 * on it so the picture zooms there.
 */
export function Transcript({ project, playhead, onSeek, onEdit }: Props) {
  const words = useMemo(() => orderedWords(project), [project]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const proposed = useMemo(
    () => new Set(project.proposals.filter((p) => p.type !== "silence" && !p.punch && p.status === "pending").flatMap((p) => p.wordIds)),
    [project.proposals],
  );
  const punched = useMemo(
    () => new Set(project.proposals.filter((p) => p.punch && p.status === "accepted").flatMap((p) => p.wordIds)),
    [project.proposals],
  );
  const kept = useMemo(() => words.map((w) => isWordKept(project.segments, w)), [words, project.segments]);
  const names = new Map(project.sources.map((s) => [s.id, s.name]));
  const several = project.sources.length > 1;

  // A new transcript (another import, a re-run) invalidates index-based selections.
  useEffect(() => {
    setAnchor(null);
    setFocus(null);
  }, [words.length]);

  const [from, to] = anchor === null || focus === null ? [-1, -2] : [Math.min(anchor, focus), Math.max(anchor, focus)];
  const selected = words.slice(from, to + 1);
  const allCut = selected.length > 0 && kept.slice(from, to + 1).every((k) => !k);
  const oneRecording = selected.every((w) => w.sourceId === selected[0]?.sourceId);

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
                {oneRecording && (
                  <button type="button" className="button" onClick={() => onEdit({ type: "punch", wordIds: selected.map((w) => w.id), style: "zoom-in" })}>
                    <ZoomIn className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                    Punch in
                  </button>
                )}
              </>
            )}
          </>
        ) : (
          <span className="editor__count">Click a word to jump to it. Shift-click to select, Delete to cut.</span>
        )}
      </div>
      <p className="transcript">
        {words.map((w, i) => {
          const heading = several && (i === 0 || words[i - 1]!.sourceId !== w.sourceId);
          const classes = ["word"];
          if (!kept[i]) classes.push("word--cut");
          else if (proposed.has(w.id)) classes.push("word--proposed");
          if (kept[i] && punched.has(w.id)) classes.push("word--punched");
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
