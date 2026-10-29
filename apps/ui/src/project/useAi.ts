import type { AgentNameValue, AiStatusValue } from "@clipcat/ipc";
import { useCallback, useEffect, useState } from "react";
import { bridge } from "../bridge";

export const AGENT_LABEL: Record<AgentNameValue, string> = {
  claude: "Claude Code",
  codex: "Codex",
  api: "Claude API (your key)",
  openai: "OpenAI (your key)",
  openrouter: "OpenRouter (your key)",
};

/** Whether an agent can run now, and what to do if not. */
export function readiness(ai: AiStatusValue, name: AgentNameValue): { ready: boolean; installed: boolean; detail: string | null } {
  if (name === "api") return { ready: ai.api.hasKey, installed: ai.api.hasKey, detail: ai.api.hasKey ? null : "Add your key in Settings." };
  if (name === "openai" || name === "openrouter") {
    const { hasKey, model } = ai[name];
    return { ready: hasKey && model !== null, installed: hasKey, detail: !hasKey ? "Add your key in Settings." : model ? null : "Pick a model in Settings." };
  }
  const s = ai[name];
  return { ready: s.status === "ready", installed: s.status !== "not-installed", detail: s.detail };
}

/** The AI the user picked and whether it can run, shared by every panel that asks it for something. */
export type Ai = {
  /** Null while checking. */
  status: AiStatusValue | null;
  setStatus: (update: (prev: AiStatusValue | null) => AiStatusValue | null) => void;
  check: () => void;
  error: string | null;
  /** The picked agent can run now. */
  ready: boolean;
  /** Why the AI buttons are off, or null when they aren't for this reason. */
  reason: string | null;
};

export function useAi(): Ai {
  const [status, setStatus] = useState<AiStatusValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(() => {
    setStatus(null);
    setError(null);
    bridge()
      ?.invoke("ai:status")
      .then(setStatus, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(check, [check]);

  const agent = status?.agent ?? "claude";
  const ready = status ? readiness(status, agent).ready : false;
  const reason = status && !ready ? `Set up ${AGENT_LABEL[agent]} in Settings first.` : null;
  return { status, setStatus, check, error, ready, reason };
}
