import type { McpAgentIdValue, McpAgentValue } from "@clipcat/ipc";
import { ArrowLeft, Plug, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";

type Props = { onBack: () => void };

const message = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));

/** What a row says about an agent: connected, ready to connect, or not on this computer. */
function state(agent: McpAgentValue): string {
  if (agent.connected) return "Connected. Restart it to pick up ClipCat's tools.";
  if (agent.unavailable) return agent.unavailable;
  return agent.detected ? "Not connected." : "Not found on this computer. You can still connect it for later.";
}

/**
 * Settings: hooking ClipCat into the coding agents on this computer, so
 * Claude Code, Codex or the Claude app can read a project's transcript and
 * make edits while ClipCat is open.
 */
export function Settings({ onBack }: Props) {
  const [agents, setAgents] = useState<McpAgentValue[] | null>(null);
  const [busy, setBusy] = useState<McpAgentIdValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bridge()
      ?.invoke("mcp:status")
      .then(setAgents, (e: unknown) => setError(message(e)));
  }, []);

  const toggle = (agent: McpAgentValue) => {
    setError(null);
    setBusy(agent.id);
    bridge()
      ?.invoke("mcp:connect", { agent: agent.id, connect: !agent.connected })
      .then(setAgents, (e: unknown) => setError(message(e)))
      .finally(() => setBusy(null));
  };

  return (
    <>
      <header className="titlebar">
        <button type="button" className="button button--icon" aria-label="Back to library" onClick={onBack}>
          <ArrowLeft className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
        </button>
        <h1 className="titlebar__title">Settings</h1>
      </header>
      <main className="settings">
        <section className="settings__section" aria-labelledby="agents-title">
          <h2 id="agents-title" className="section-title">
            Edit from your coding agent
          </h2>
          <p className="settings__body">
            Connect an agent and, while ClipCat is open, it can read your transcripts, cut words, accept suggested edits, add punch-ins, b-roll and
            sounds, and start exports. Every change shows up here and can be undone.
          </p>
          {error && (
            <p className="notice notice--danger" role="alert">
              {error}
            </p>
          )}
          <ul className="agents" aria-label="Coding agents">
            {(agents ?? []).map((agent) => (
              <li key={agent.id} className="agents__item">
                <div className="agents__text">
                  <span className="agents__name">{agent.label}</span>
                  <span className="agents__state">{state(agent)}</span>
                  <span className="agents__path" title={agent.config}>
                    {agent.config}
                  </span>
                </div>
                <button
                  type="button"
                  className={agent.connected ? "button" : "button button--primary"}
                  disabled={busy !== null || (!agent.connected && agent.unavailable !== null)}
                  aria-label={`${agent.connected ? "Disconnect" : "Connect"} ${agent.label}`}
                  onClick={() => toggle(agent)}
                >
                  {agent.connected ? (
                    <Unplug className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                  ) : (
                    <Plug className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                  )}
                  {busy === agent.id ? "Saving…" : agent.connected ? "Disconnect" : "Connect"}
                </button>
              </li>
            ))}
          </ul>
          <p className="settings__hint">
            Then ask it something like "In ClipCat, cut the filler words from my newest project" or "Export my launch video as a vertical short".
          </p>
        </section>
      </main>
    </>
  );
}
