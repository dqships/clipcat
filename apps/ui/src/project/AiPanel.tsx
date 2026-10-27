import type { Project, Proposal } from "@clipcat/core";
import type { AgentNameValue, AiStatusValue } from "@clipcat/ipc";
import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";
import type { ProjectJobs } from "../useJobs";

const AI_TYPES = new Set<Proposal["type"]>(["retake", "cleanup", "tighten"]);

const AGENT_LABEL: Record<AgentNameValue, string> = { claude: "Claude Code", codex: "Codex" };

type Props = { project: Project; jobs: ProjectJobs };

/**
 * Asks the user's Claude Code or Codex for cuts: which one, an optional brief
 * and one button. What comes back is listed with the other suggested cuts to
 * accept or reject.
 */
export function AiPanel({ project, jobs }: Props) {
  const [ai, setAi] = useState<AiStatusValue | null>(null);
  const [brief, setBrief] = useState(project.brief);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(() => {
    setAi(null);
    bridge()
      ?.invoke("ai:status")
      .then(setAi, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(check, [check]);

  const running = jobs.active?.kind === "analyze";
  const agent = ai?.agent ?? "claude";
  const status = ai?.[agent] ?? null;
  const ready = status?.status === "ready";
  const label = AGENT_LABEL[agent];

  const choose = (next: AgentNameValue) => {
    setError(null);
    setAi((prev) => (prev ? { ...prev, agent: next } : prev));
    bridge()
      ?.invoke("settings:set", { agent: next })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const hasWords = project.transcript.length > 0;
  const proposals = project.proposals.filter((p) => AI_TYPES.has(p.type) && p.status === "pending");

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
      <label className="field">
        <span className="field__label">Find cuts with</span>
        <select className="field__control" value={agent} disabled={!ai || running} onChange={(e) => choose(e.target.value as AgentNameValue)}>
          {(Object.keys(AGENT_LABEL) as AgentNameValue[]).map((name) => (
            <option key={name} value={name}>
              {AGENT_LABEL[name]}
              {ai && ai[name].status !== "ready" ? " (not set up)" : ""}
            </option>
          ))}
        </select>
      </label>
      {status && !ready && (
        <div className="notice ai__notice" role="status">
          <span>
            {status.status === "not-installed" ? `ClipCat uses your ${label} to find cuts.` : `${label} isn't ready.`} {status.detail}
          </span>
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
    </section>
  );
}
