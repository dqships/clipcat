import type { Project, Proposal } from "@clipcat/core";
import type { AgentNameValue, AiStatusValue } from "@clipcat/ipc";
import { Copy, MessageSquare, Scissors, Settings2 } from "lucide-react";
import { useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";
import { API_MODEL_LABEL, PROVIDER_LABEL } from "../settings/AiModels";
import type { ProjectJobs } from "../useJobs";
import { AGENT_LABEL, type Ai, readiness } from "./useAi";

const AI_TYPES = new Set<Proposal["type"]>(["retake", "cleanup", "tighten"]);

/** The model the picked AI runs, as the Settings page names it. */
function modelText(ai: AiStatusValue, name: AgentNameValue): string {
  if (name === "api") return API_MODEL_LABEL[ai.api.model];
  if (name === "openai" || name === "openrouter") return ai[name].model ?? "none picked";
  const { selected, choices, fallback } = ai.models[name];
  if (!selected) return fallback ? `default (${fallback})` : "default";
  return choices.find((c) => c.id === selected)?.label ?? selected;
}

type Props = { project: Project; jobs: ProjectJobs; ai: Ai; onSettings: () => void };

/**
 * Asks the user's Claude Code, Codex or Claude API key for a first edit:
 * which one, an optional brief and one button. Models and keys are set up
 * in Settings; this only picks among them. What comes back is listed
 * with the other suggested edits to accept or reject.
 */
export function AiPanel({ project, jobs, ai: shared, onSettings }: Props) {
  const { status: ai, setStatus: setAi } = shared;
  const [brief, setBrief] = useState(project.brief);
  const [failure, setError] = useState<string | null>(null);
  const error = failure ?? shared.error;

  const running = jobs.active?.kind === "analyze" || jobs.active?.kind === "correct";
  const [request, setRequest] = useState("");
  const [copied, setCopied] = useState(false);
  const agent = ai?.agent ?? "claude";
  const status = ai ? readiness(ai, agent) : null;
  const ready = status?.ready ?? false;
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

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const findCuts = () => {
    setError(null);
    bridge()?.invoke("project:analyze", { id: project.id, brief }).catch(fail);
  };
  const ask = () => {
    if (!request.trim()) return;
    setError(null);
    bridge()
      ?.invoke("project:request", { id: project.id, request })
      .then(() => setRequest(""), fail);
  };
  const copyTitle = () => {
    navigator.clipboard.writeText(project.suggestedTitle).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, fail);
  };

  return (
    <section className="ai" aria-labelledby="ai-title">
      <h2 id="ai-title" className="section-title">
        AI editor
      </h2>
      <label className="field">
        <span className="field__label">Use</span>
        <select className="field__control" value={agent} disabled={!ai || running} onChange={(e) => choose(e.target.value as AgentNameValue)}>
          {(Object.keys(AGENT_LABEL) as AgentNameValue[]).map((name) => (
            <option key={name} value={name}>
              {AGENT_LABEL[name]}
              {ai && !readiness(ai, name).ready ? " (not set up)" : ""}
            </option>
          ))}
        </select>
      </label>
      {ai && (
        <p className="ai__hint ai__row">
          <span>
            {ready ? `Model: ${modelText(ai, agent)}.` : `${PROVIDER_LABEL[agent]} isn't ${status?.installed ? "ready" : "set up"}. ${status?.detail ?? ""}`}
          </span>
          <button type="button" className="button" onClick={onSettings}>
            <Settings2 className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
            {ready ? "AI settings" : `Set up ${PROVIDER_LABEL[agent]}`}
          </button>
        </p>
      )}
      <label className="ai__label" htmlFor="ai-brief">
        What should the edit do? (optional)
      </label>
      <textarea
        id="ai-brief"
        className="ai__brief"
        rows={2}
        placeholder="Keep the intro, cut the tangent about pricing…"
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
      />
      <p className="ai__hint">Used each time you choose Suggest an edit.</p>
      <div className="ai__actions">
        <button type="button" className="button button--primary" disabled={!ready || !hasWords || running} onClick={findCuts}>
          <Scissors className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          {running ? "Suggesting an edit…" : proposals.length > 0 ? "Suggest again" : "Suggest an edit"}
        </button>
        {!hasWords ? (
          <span className="ai__hint">Available once the transcript is ready.</span>
        ) : (
          status && !ready && <span className="ai__hint">Set up {label} in Settings first.</span>
        )}
      </div>
      <label className="ai__label" htmlFor="ai-request">
        Ask for a change
      </label>
      <div className="ai__row">
        <input
          id="ai-request"
          className="ai__brief"
          placeholder="Cut the part about pricing"
          value={request}
          maxLength={1000}
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ask();
          }}
        />
        <button type="button" className="button" disabled={!ready || !hasWords || running || !request.trim()} onClick={ask}>
          <MessageSquare className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          Send
        </button>
      </div>
      {error && (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      )}
      {project.suggestedTitle && (
        <p className="ai__hint ai__row">
          <span>Suggested title: {project.suggestedTitle}</span>
          <button type="button" className="button" onClick={copyTitle}>
            <Copy className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
            {copied ? "Copied" : "Copy"}
          </button>
        </p>
      )}
    </section>
  );
}
