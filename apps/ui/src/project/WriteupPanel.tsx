import { CHAPTERS, type EditOp, type Project, buildTimeline, chapterTime, postText, timedChapters } from "@clipcat/core";
import { Copy, FileDown, PenLine, X } from "lucide-react";
import { useMemo, useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";
import type { ProjectJobs } from "../useJobs";
import type { Ai } from "./useAi";

type Props = { project: Project; jobs: ProjectJobs; ai: Ai; onSeek: (sourceId: string, time: number) => void; onEdit: (op: EditOp) => void };

/**
 * What goes with the video when it's posted: chapters on the words they
 * start with (they follow the edit), a description to paste with the
 * chapters under it, and an article to save as Markdown. The AI editor
 * writes a draft from the edited transcript, and every part can be changed.
 */
export function WriteupPanel({ project, jobs, ai, onSeek, onEdit }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const running = jobs.active?.kind === "writeup";
  const w = project.writeup;
  const timeline = useMemo(() => buildTimeline(project), [project]);
  const chapters = useMemo(() => timedChapters(project, timeline), [project, timeline]);
  const words = useMemo(() => new Map(project.transcript.map((x) => [x.id, x])), [project.transcript]);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const write = () => {
    setError(null);
    bridge()?.invoke("project:writeup", { id: project.id }).catch(fail);
  };
  const copy = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(postText(w?.description ?? "", chapters));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      fail(e);
    }
  };
  const save = () => {
    setError(null);
    bridge()?.invoke("project:save-article", { id: project.id }).catch(fail);
  };

  return (
    <section className="panel" aria-labelledby="writeup-title">
      <h2 id="writeup-title" className="section-title">
        Chapters and article
      </h2>
      <p className="project__summary">
        {w
          ? "Chapters follow their words through the edit, and go into the exported file. Rewriting replaces the chapters, description and article, including your changes."
          : "The AI editor writes chapters, a description and an article from the edited video. Select a word in the transcript to start a chapter there yourself."}
      </p>
      <div className="ai__actions">
        <button type="button" className="button" disabled={project.transcript.length === 0 || !ai.ready || running} onClick={write}>
          <PenLine className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          {running ? "Writing…" : w ? "Rewrite chapters and article" : "Write chapters and article"}
        </button>
        {project.transcript.length > 0 && ai.reason && <span className="ai__hint">{ai.reason}</span>}
      </div>
      {error && (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      )}
      {chapters.length > 0 && (
        <ol className="punches" aria-label="Chapters">
          {chapters.map((c) => {
            const word = words.get(c.wordId);
            const at = chapterTime(c.start);
            return (
              <li key={c.wordId} className="punches__item chapters__item">
                <button type="button" className="punches__where punches__time" aria-label={`Go to the chapter at ${at}`} onClick={() => word && onSeek(word.sourceId, word.start)}>
                  {at}
                </button>
                <input
                  key={c.title}
                  className="field__control"
                  aria-label={`Title of the chapter at ${at}`}
                  defaultValue={c.title}
                  maxLength={100}
                  onBlur={(e) => {
                    const title = e.target.value.trim();
                    if (title && title !== c.title) onEdit({ type: "chapter", wordId: c.wordId, title });
                  }}
                />
                <button type="button" className="button button--icon" aria-label={`Remove the chapter at ${at}`} onClick={() => onEdit({ type: "remove-chapter", wordId: c.wordId })}>
                  <X className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {chapters.length > 0 && chapters.length < CHAPTERS.min && (
        <p className="project__summary">YouTube shows chapters once there are at least {CHAPTERS.min}.</p>
      )}
      {w && (
        <>
          <label className="field">
            <span className="field__label">Description</span>
            <textarea
              key={w.description}
              className="field__control media__description"
              defaultValue={w.description}
              rows={3}
              maxLength={5000}
              onBlur={(e) => {
                if (e.target.value !== w.description) onEdit({ type: "writeup", description: e.target.value });
              }}
            />
          </label>
          <div>
            <button type="button" className="button" onClick={() => void copy()}>
              <Copy className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              {copied ? "Copied" : "Copy description and chapters"}
            </button>
          </div>
          <label className="field">
            <span className="field__label">Article title</span>
            <input
              key={w.article.title}
              className="field__control"
              defaultValue={w.article.title}
              maxLength={200}
              onBlur={(e) => {
                if (e.target.value !== w.article.title) onEdit({ type: "writeup", articleTitle: e.target.value });
              }}
            />
          </label>
          <label className="field">
            <span className="field__label">Article (Markdown)</span>
            <textarea
              key={w.article.markdown}
              className="field__control media__description"
              defaultValue={w.article.markdown}
              rows={10}
              maxLength={100_000}
              onBlur={(e) => {
                if (e.target.value !== w.article.markdown) onEdit({ type: "writeup", article: e.target.value });
              }}
            />
          </label>
          <div>
            <button type="button" className="button" disabled={!w.article.markdown.trim()} onClick={save}>
              <FileDown className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              Save article as Markdown…
            </button>
          </div>
        </>
      )}
    </section>
  );
}
