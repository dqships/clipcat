import type { Project, Proposal } from "@clipcat/core";
import type { AgentNameValue, AiStatusValue, ApiModelValue } from "@clipcat/ipc";
import { KeyRound, MessageSquare, Sparkles, SpellCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";
import type { ProjectJobs } from "../useJobs";

const AI_TYPES = new Set<Proposal["type"]>(["retake", "cleanup", "tighten"]);

const AGENT_LABEL: Record<AgentNameValue, string> = { claude: "Claude Code", codex: "Codex", api: "Claude API (your key)" };

const MODEL_LABEL: Record<ApiModelValue, string> = {
  "claude-opus-5-5": "Opus 5.5 (best)",
  "claude-sonnet-5-5": "Sonnet 5.5",
  "claude-haiku-5-5": "Haiku 5.5 (cheapest)",
};

/** What the empty choice means: the CLI's own default, named when the CLI says which. */
function defaultModelLabel(ai: AiStatusValue, name: "claude" | "codex"): string {
  const fallback = ai.models[name].fallback;
  return `${AGENT_LABEL[name]} default${fallback ? ` (${fallback})` : ""}`;
}

/** The models to offer, with a picked one that has since left the list kept in it. */
function modelChoices(ai: AiStatusValue, name: "claude" | "codex"): { id: string; label: string }[] {
  const { choices, selected } = ai.models[name];
  return selected && !choices.some((c) => c.id === selected) ? [...choices, { id: selected, label: selected }] : choices;
}

/** Whether an agent can run now, and what to do if not. */
function readiness(ai: AiStatusValue, name: AgentNameValue): { ready: boolean; installed: boolean; detail: string | null } {
  if (name === "api") return { ready: ai.api.hasKey, installed: ai.api.hasKey, detail: ai.api.hasKey ? null : "Add a key from console.anthropic.com below." };
  const s = ai[name];
  return { ready: s.status === "ready", installed: s.status !== "not-installed", detail: s.detail };
}

type Props = { project: Project; jobs: ProjectJobs };

/**
 * Asks the user's Claude Code, Codex or Claude API key for cuts: which one,
 * an optional brief and one button. What comes back is listed with the other
 * suggested cuts to accept or reject.
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

  const running = jobs.active?.kind === "analyze" || jobs.active?.kind === "correct";
  const [request, setRequest] = useState("");
  const [terms, setTerms] = useState<string | null>(null);

  useEffect(() => {
    bridge()
      ?.invoke("settings:get")
      .then((s) => setTerms(s.dictionary.join(", ")), () => setTerms(""));
  }, []);
  const agent = ai?.agent ?? "claude";
  const status = ai ? readiness(ai, agent) : null;
  const ready = status?.ready ?? false;
  const label = AGENT_LABEL[agent];
  const [key, setKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  const choose = (next: AgentNameValue) => {
    setError(null);
    setAi((prev) => (prev ? { ...prev, agent: next } : prev));
    bridge()
      ?.invoke("settings:set", { agent: next })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const saveKey = (next: string | null) => {
    setError(null);
    setSavingKey(true);
    bridge()
      ?.invoke("settings:api-key", { key: next })
      .then(
        (api) => {
          setAi((prev) => (prev ? { ...prev, api } : prev));
          setKey("");
        },
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setSavingKey(false));
  };
  const chooseModel = (model: ApiModelValue) => {
    setAi((prev) => (prev ? { ...prev, api: { ...prev.api, model } } : prev));
    bridge()
      ?.invoke("settings:set", { apiModel: model })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const chooseAgentModel = (name: "claude" | "codex", model: string | null) => {
    setAi((prev) => (prev ? { ...prev, models: { ...prev.models, [name]: { ...prev.models[name], selected: model } } } : prev));
    bridge()
      ?.invoke("settings:set", name === "codex" ? { codexModel: model } : { claudeModel: model })
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
  const saveTerms = () => {
    if (terms === null) return;
    const dictionary = [...new Set(terms.split(/[,\n]/).map((t) => t.trim()).filter(Boolean))].slice(0, 200).map((t) => t.slice(0, 60));
    bridge()?.invoke("settings:set", { dictionary }).catch(fail);
  };
  const fixTranscript = () => {
    setError(null);
    saveTerms();
    bridge()?.invoke("project:correct", { id: project.id }).catch(fail);
  };

  return (
    <section className="ai" aria-labelledby="ai-title">
      <h2 id="ai-title" className="section-title">
        AI editor
      </h2>
      <label className="field">
        <span className="field__label">Find cuts with</span>
        <select className="field__control" value={agent} disabled={!ai || running} onChange={(e) => choose(e.target.value as AgentNameValue)}>
          {(Object.keys(AGENT_LABEL) as AgentNameValue[]).map((name) => (
            <option key={name} value={name}>
              {AGENT_LABEL[name]}
              {ai && !readiness(ai, name).ready ? " (not set up)" : ""}
            </option>
          ))}
        </select>
      </label>
      {ai && agent !== "api" && (
        <label className="field">
          <span className="field__label">Model</span>
          <select
            className="field__control"
            value={ai.models[agent].selected ?? ""}
            disabled={running}
            onChange={(e) => chooseAgentModel(agent, e.target.value || null)}
          >
            <option value="">{defaultModelLabel(ai, agent)}</option>
            {modelChoices(ai, agent).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {status && !ready && agent !== "api" && (
        <div className="notice ai__notice" role="status">
          <span>
            {status.installed ? `${label} isn't ready.` : `ClipCat uses your ${label} to find cuts.`} {status.detail}
          </span>
          <button type="button" className="button" onClick={check}>
            Check again
          </button>
        </div>
      )}
      {ai && agent === "api" && (
        <div className="ai__api">
          <label className="field">
            <span className="field__label">Model</span>
            <select className="field__control" value={ai.api.model} disabled={running} onChange={(e) => chooseModel(e.target.value as ApiModelValue)}>
              {(Object.keys(MODEL_LABEL) as ApiModelValue[]).map((m) => (
                <option key={m} value={m}>
                  {MODEL_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          {ai.api.hasKey ? (
            <p className="ai__hint ai__row">
              <span>Your API key is saved, encrypted, on this computer. Each run is billed to it.</span>
              <button type="button" className="button" disabled={savingKey || running} onClick={() => saveKey(null)}>
                Remove key
              </button>
            </p>
          ) : (
            <div className="ai__row">
              <input
                className="ai__brief"
                type="password"
                autoComplete="off"
                aria-label="Claude API key"
                placeholder="sk-ant-…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button type="button" className="button" disabled={savingKey || key.trim().length < 10} onClick={() => saveKey(key.trim())}>
                <KeyRound className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                {savingKey ? "Checking…" : "Save key"}
              </button>
            </div>
          )}
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
          Ask
        </button>
      </div>
      <label className="ai__label" htmlFor="ai-terms">
        Names and terms you use (help transcription spell them)
      </label>
      <div className="ai__row">
        <input
          id="ai-terms"
          className="ai__brief"
          placeholder="ClipCat, DaQuan, Vercel"
          value={terms ?? ""}
          disabled={terms === null}
          onChange={(e) => setTerms(e.target.value)}
          onBlur={saveTerms}
        />
        <button type="button" className="button" disabled={!ready || !hasWords || running} onClick={fixTranscript}>
          <SpellCheck className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          Fix transcript
        </button>
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
