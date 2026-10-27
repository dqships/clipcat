import type { Project, Proposal } from "@clipcat/core";
import type { AgentStatusValue } from "@clipcat/ipc";
import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { bridge } from "../bridge";
import { formatDuration } from "../format";
import { ICON_STROKE } from "../icons";
import type { ProjectJobs } from "../useJobs";

const AI_TYPES = new Set<Proposal["type"]>(["retake", "cleanup", "tighten"]);

const TYPE_LABEL: Record<string, string> = { retake: "Retake", cleanup: "Clean-up", tighten: "Tighten" };

type Props = { project: Project; jobs: ProjectJobs; onSeek: (seconds: number) => void };

/**
 * Asks the user's Claude Code for cuts: an optional brief, one button, and the
 * proposals it came back with. Accepting and rejecting them comes with the
 * transcript editor.
 */
export function AiPanel({ project, jobs, onSeek }: Props) {
  const [claude, setClaude] = useState<AgentStatusValue | null>(null);
  const [brief, setBrief] = useState(project.brief);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(() => {
    setClaude(null);
    bridge()
      ?.invoke("ai:status")
      .then((s) => setClaude(s.claude), (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(check, [check]);

  const running = jobs.active?.kind === "analyze";
  const ready = claude?.status === "ready";
  const hasWords = project.transcript.length > 0;
  const proposals = project.proposals.filter((p) => AI_TYPES.has(p.type) && p.status === "pending");
  const seconds = proposals.reduce((n, p) => n + p.cuts.reduce((m, [a, b]) => m + (b - a), 0), 0);
  const text = new Map(project.transcript.map((w) => [w.id, w.text]));

  const findCuts = () => {
    setError(null);
    bridge()
      ?.invoke("project:analyze", { id: project.id, brief })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <section className="ai" aria-labelledby="ai-title">
      <h2 id="ai-title" className="section-title">
        AI cuts
      </h2>
      {claude && !ready && (
        <div className="notice ai__notice" role="status">
          <span>{claude.status === "not-installed" ? "ClipCat uses your Claude Code to find cuts." : "Claude Code isn't ready."} {claude.detail}</span>
          <button type="button" className="button" onClick={check}>
            Check again
          </button>
        </div>
      )}
      <label className="ai__label" htmlFor="ai-brief">
        Brief (optional)
      </label>
      <textarea
        id="ai-brief"
        className="ai__brief"
        rows={2}
        placeholder="Keep the intro, cut the tangent about pricing…"
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
      />
      <div className="ai__actions">
        <button type="button" className="button button--primary" disabled={!ready || !hasWords || running} onClick={findCuts}>
          <Sparkles className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          {running ? "Finding cuts…" : proposals.length > 0 ? "Find cuts again" : "Find cuts"}
        </button>
        {!hasWords && <span className="ai__hint">Available once the transcript is ready.</span>}
      </div>
      {error && (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      )}
      {project.suggestedTitle && <p className="ai__hint">Suggested title: {project.suggestedTitle}</p>}
      {proposals.length > 0 && (
        <>
          <p className="project__summary">
            {proposals.length} {proposals.length === 1 ? "cut" : "cuts"} proposed, {formatDuration(seconds)} in all.
          </p>
          <ol className="proposals">
            {proposals.map((p) => (
              <li key={p.id}>
                <button type="button" className="proposal" onClick={() => onSeek(p.cuts[0]?.[0] ?? 0)}>
                  <span className="proposal__type">{TYPE_LABEL[p.type] ?? p.type}</span>
                  <span className="proposal__reason">{p.reason}</span>
                  <span className="proposal__words">“{p.wordIds.map((id) => text.get(id) ?? "").join(" ")}”</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
