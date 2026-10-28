import type { McpAgentIdValue, McpAgentValue, UpdateStatusValue } from "@clipcat/ipc";
import { ArrowLeft, Download, FileArchive, FolderOpen, Plug, RefreshCw, RotateCw, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";
import { AgentCli } from "./AgentCli";
import { AgentGuide } from "./AgentGuide";

type Props = { update: UpdateStatusValue | null; onBack: () => void };

const message = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));

/** The command-line tool behind an agent row, for the ones that have one. */
const CLI_OF: Partial<Record<McpAgentIdValue, "claude" | "codex">> = { "claude-code": "claude", codex: "codex" };

/** What a row says about an agent: connected, ready to connect, or not on this computer. */
function state(agent: McpAgentValue): string {
  if (agent.connected) return "Connected. Restart it to pick up ClipCat's tools.";
  if (agent.unavailable) return agent.unavailable;
  return agent.detected ? "Not connected." : "Not found on this computer. You can still connect it for later.";
}

/** One sentence on where updating stands. */
function updateText(u: UpdateStatusValue | null): string {
  switch (u?.state) {
    case undefined:
    case "off":
      return "This copy doesn't update itself (it was built here rather than downloaded).";
    case "checking":
      return "Checking for a new version…";
    case "downloading":
      return `Downloading ${u.version ? `ClipCat ${u.version}` : "the new version"}…`;
    case "ready":
      return `ClipCat ${u.version ?? "update"} is downloaded. Restart to use it.`;
    case "available":
      return `ClipCat ${u.version} is out. This copy can't install it by itself, so download it from the release page.`;
    case "error":
      return u.detail ?? "Couldn't check for updates.";
    default:
      return "You have the newest version.";
  }
}

/**
 * Settings: hooking ClipCat into the coding agents on this computer, so
 * Claude Code, Codex or the Claude app can read a project's transcript and
 * make edits while ClipCat is open.
 */
export function Settings({ update, onBack }: Props) {
  const [agents, setAgents] = useState<McpAgentValue[] | null>(null);
  const [busy, setBusy] = useState<McpAgentIdValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  const saveDiagnostics = () => {
    setError(null);
    setSaving(true);
    bridge()
      ?.invoke("app:diagnostics")
      .then(({ path }) => setSaved(path), (e: unknown) => setError(message(e)))
      .finally(() => setSaving(false));
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
                  {CLI_OF[agent.id] && <AgentCli cli={CLI_OF[agent.id]!} />}
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
        </section>
        <AgentGuide agents={agents} />
        <section className="settings__section" aria-labelledby="updates-title">
          <h2 id="updates-title" className="section-title">
            Updates
          </h2>
          <p className="settings__body" role="status">
            {updateText(update)}
          </p>
          <div className="settings__actions">
            {update?.state === "ready" ? (
              <button type="button" className="button button--primary" onClick={() => void bridge()?.invoke("update:install")}>
                <RotateCw className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                Restart to update
              </button>
            ) : update?.state === "available" ? (
              <button type="button" className="button button--primary" onClick={() => void bridge()?.invoke("update:open")}>
                <Download className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                Open the release page
              </button>
            ) : (
              <button
                type="button"
                className="button"
                disabled={!update || update.state === "off" || update.state === "checking" || update.state === "downloading"}
                onClick={() => void bridge()?.invoke("update:check")}
              >
                <RefreshCw className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                Check now
              </button>
            )}
          </div>
        </section>
        <section className="settings__section" aria-labelledby="help-title">
          <h2 id="help-title" className="section-title">
            When something goes wrong
          </h2>
          <p className="settings__body">
            Diagnostics are one zip: ClipCat's log, its versions and setup, recent jobs, each project's history and crash reports. It holds no video,
            sound or transcript, so it's safe to attach to a bug report.
          </p>
          <div className="settings__actions">
            <button type="button" className="button" disabled={saving} onClick={saveDiagnostics}>
              <FileArchive className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              {saving ? "Saving…" : "Save diagnostics"}
            </button>
            <button type="button" className="button" onClick={() => void bridge()?.invoke("app:reveal-logs")}>
              <FolderOpen className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              Show the log
            </button>
          </div>
          {saved && <p className="settings__hint">Saved {saved.split(/[\\/]/).at(-1)}.</p>}
        </section>
      </main>
    </>
  );
}
