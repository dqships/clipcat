import type { McpAgentIdValue, McpAgentValue, McpCheckStepValue, McpSetupValue } from "@clipcat/ipc";
import { Check, Clock, Copy, Download, LoaderCircle, Minus, Plug, RefreshCw, Unplug, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";
import { AgentCli } from "./AgentCli";

const message = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));

/** When something happened, the way a person says it: "just now", "12 min ago", "at 9:41", "on 27 Oct". */
export function since(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (then.toDateString() === now.toDateString()) return `at ${then.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return `on ${then.toLocaleDateString([], { day: "numeric", month: "short" })}`;
}

/** The home folder as ~ in a config path, which is how people read it. */
const short = (path: string) => path.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Z]:\\Users\\[^\\]+)/, "~");

/** The one line under an agent's name: what it has actually done, not just what the file says. */
function summary(agent: McpAgentValue): string {
  const { session } = agent;
  if (agent.connected) {
    if (session.live) return `Connected now${session.client ? ` (${session.client})` : ""}.`;
    if (session.lastAt) return `Added. Last connected ${since(session.lastAt)}${session.client ? ` (${session.client})` : ""}.`;
    return "Added, but it hasn't connected yet.";
  }
  if (agent.unavailable) return agent.unavailable;
  return agent.detected ? "Not connected." : "Not found on this computer. You can still connect it for later.";
}

/** What the agent itself will do about permission, so "no sign-in" isn't read as "no control". */
const ASKS: Record<McpAgentIdValue, string> = {
  "claude-code": "Claude Code asks before it uses each ClipCat tool, unless you tell it to always allow one.",
  codex: "Whether Codex asks before it uses a ClipCat tool follows its approval setting.",
  "claude-desktop": "The Claude app asks before it uses each ClipCat tool, unless you tell it to always allow one.",
  cursor: "Whether Cursor asks before it uses a ClipCat tool follows its run settings.",
  vscode: "VS Code asks before it uses each ClipCat tool, unless you tell it to always allow one.",
  windsurf: "Whether Windsurf asks before it uses a ClipCat tool follows its Cascade settings.",
  "lm-studio": "LM Studio asks before it uses each ClipCat tool, unless you tell it to always allow one.",
  gemini: "Gemini CLI asks before it uses each ClipCat tool, unless you tell it to always allow one.",
};

/** What to do so the agent's first session shows up here. */
const NEXT: Record<McpAgentIdValue, string> = {
  "claude-code": "Waiting for Claude Code. Start a new session and ask it to list your ClipCat projects.",
  codex: "Waiting for Codex. Start a new session (or reopen the Codex app) and ask it to list your ClipCat projects.",
  "claude-desktop": "Waiting for the Claude app. It connects when it opens again.",
  cursor: "Waiting for Cursor. Open a new window and ask the agent to list your ClipCat projects.",
  vscode: "Waiting for VS Code. Open a new window, then ask Copilot's agent mode to list your ClipCat projects.",
  windsurf: "Waiting for Windsurf. Restart it and ask Cascade to list your ClipCat projects.",
  "lm-studio": "Waiting for LM Studio. Open it again, turn on clipcat in a chat, and ask it to list your ClipCat projects.",
  gemini: "Waiting for Gemini CLI. Start a new gemini session and ask it to list your ClipCat projects.",
};

/** The last step, from what really arrived on ClipCat's socket; it updates on its own. */
type Line = { id: McpCheckStepValue["id"] | "used"; state: McpCheckStepValue["state"]; text: string };

function usedStep(agent: McpAgentValue): Line {
  const { session } = agent;
  const client = session.client ? ` (${session.client})` : "";
  if (session.live) return { id: "used", state: "ok", text: `${agent.label} is connected now${client}.` };
  if (session.lastAt) return { id: "used", state: "ok", text: `${agent.label} connected ${since(session.lastAt)}${client}.` };
  return { id: "used", state: "waiting", text: NEXT[agent.id] };
}

const STEP_ICON = { ok: Check, failed: X, waiting: Clock, skipped: Minus } as const;
const STEP_LABEL = { ok: "Done", failed: "Failed", waiting: "Waiting", skipped: "Skipped" } as const;

function Steps({ agent, steps }: { agent: McpAgentValue; steps: McpCheckStepValue[] | "running" }) {
  if (steps === "running") {
    return (
      <p className="steps__running" role="status">
        <LoaderCircle className="icon-sm job__spin" strokeWidth={ICON_STROKE} aria-hidden />
        Checking the connection: reading the file back, running it, and asking {agent.label}…
      </p>
    );
  }
  return (
    <ol className="steps" aria-label={`${agent.label} connection check`}>
      {[...steps, usedStep(agent)].map((step: Line) => {
        const Icon = STEP_ICON[step.state];
        return (
          <li key={step.id} className={`steps__item steps__item--${step.state}`}>
            <Icon className="icon-sm steps__icon" strokeWidth={ICON_STROKE} aria-label={STEP_LABEL[step.state]} />
            <span>{step.text}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** A value from the setup, with a button that copies it. */
function CopyLine({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(value).then(() => setCopied(true));
  const name = label === "JSON" ? label : label.toLowerCase();
  return (
    <div className="setup__line">
      <div className="setup__head">
        <span className="field__label">{label}</span>
        <button type="button" className="button button--icon" aria-label={copied ? `Copied ${name}` : `Copy ${name}`} title="Copy" onClick={copy}>
          {copied ? <Check className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden /> : <Copy className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />}
        </button>
      </div>
      {children ?? <pre className="agents__code">{value}</pre>}
    </div>
  );
}

/**
 * For an MCP app ClipCat doesn't list: the exact command, arguments and
 * environment this copy of ClipCat needs, as JSON and as the parts an app's
 * form asks for.
 */
function OtherApp() {
  const [setup, setSetup] = useState<McpSetupValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    bridge()?.invoke("mcp:setup").then(setSetup, (e: unknown) => setError(message(e)));
  }, []);
  const env = setup ? Object.entries(setup.env).map(([k, v]) => `${k}=${v}`).join("\n") : "";
  return (
    <details className="agents__more">
      <summary>Set up another MCP app</summary>
      <p className="settings__body">
        Any app that runs local (stdio) MCP servers can use ClipCat. Paste the JSON into its MCP settings file, inside its list of servers, or
        fill in its form with the parts below. Keep ClipCat open while you work. ClipCat doesn't keep this one up to date, so copy it again if
        you move the app.
      </p>
      {error && (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      )}
      {setup?.unavailable && <p className="settings__hint">{setup.unavailable}</p>}
      {setup && !setup.unavailable && (
        <div className="setup__lines">
          <CopyLine label="JSON" value={setup.json} />
          <CopyLine label="Command" value={setup.command} />
          <CopyLine label="Arguments" value={setup.args.join("\n")} />
          <CopyLine label="Environment" value={env} />
        </div>
      )}
    </details>
  );
}

/** The command-line tool behind an agent row, for the ones that have one. */
const CLI_OF: Partial<Record<McpAgentIdValue, "claude" | "codex" | "gemini">> = { "claude-code": "claude", codex: "codex", gemini: "gemini" };

/** Where the desktop apps are downloaded from: each maker's own page, since ClipCat can't install an app for you. */
const DOWNLOAD: Partial<Record<McpAgentIdValue, { site: string; url: string }>> = {
  "claude-desktop": { site: "claude.ai/download", url: "https://claude.ai/download" },
  cursor: { site: "cursor.com/download", url: "https://cursor.com/download" },
  vscode: { site: "code.visualstudio.com/download", url: "https://code.visualstudio.com/download" },
  windsurf: { site: "windsurf.com/download", url: "https://windsurf.com/download" },
  "lm-studio": { site: "lmstudio.ai/download", url: "https://lmstudio.ai/download" },
};

/**
 * The coding agents ClipCat can be added to. Connect shows exactly what it
 * will write and asks first; then each connection is checked for real (the
 * file read back, the entry run through to ClipCat, the agent's own CLI
 * asked), and the last line follows the sessions agents actually open.
 */
export function Agents({ agents, onAgents: setAgents }: { agents: McpAgentValue[] | null; onAgents: (agents: McpAgentValue[]) => void }) {
  const [confirming, setConfirming] = useState<McpAgentIdValue | null>(null);
  const [busy, setBusy] = useState<McpAgentIdValue | null>(null);
  const [checks, setChecks] = useState<Partial<Record<McpAgentIdValue, McpCheckStepValue[] | "running">>>({});
  const [errors, setErrors] = useState<Partial<Record<McpAgentIdValue, string>>>({});

  const fail = (id: McpAgentIdValue, e: unknown) => setErrors((all) => ({ ...all, [id]: message(e) }));

  const check = async (id: McpAgentIdValue) => {
    const api = bridge();
    if (!api) return;
    setChecks((all) => ({ ...all, [id]: "running" }));
    try {
      const steps = await api.invoke("mcp:check", { agent: id });
      setChecks((all) => ({ ...all, [id]: steps }));
      setAgents(await api.invoke("mcp:status"));
    } catch (e) {
      setChecks(({ [id]: _gone, ...rest }) => rest);
      fail(id, e);
    }
  };

  const connect = async (agent: McpAgentValue, on: boolean) => {
    const api = bridge();
    if (!api) return;
    setErrors(({ [agent.id]: _gone, ...rest }) => rest);
    setConfirming(null);
    setBusy(agent.id);
    try {
      setAgents(await api.invoke("mcp:connect", { agent: agent.id, connect: on }));
    } catch (e) {
      fail(agent.id, e);
      return;
    } finally {
      setBusy(null);
    }
    if (on) await check(agent.id);
    else setChecks(({ [agent.id]: _gone, ...rest }) => rest);
  };

  const row = (agent: McpAgentValue) => {
    const steps = checks[agent.id];
    const error = errors[agent.id];
    const working = busy !== null || steps === "running";
    return (
      <li key={agent.id} className="agents__item">
        <div className="agents__row">
          <div className="agents__text">
            <span className="agents__name">{agent.label}</span>
            <span className="agents__state" role="status">
              {summary(agent)}
            </span>
            <span className="agents__path" title={agent.config}>
              {short(agent.config)}
            </span>
          </div>
          <div className="agents__actions">
            {agent.connected && (
              <button type="button" className="button" disabled={working} aria-label={`Test ${agent.label}`} onClick={() => void check(agent.id)}>
                <RefreshCw className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                Test
              </button>
            )}
            {agent.connected ? (
              <button type="button" className="button" disabled={working} aria-label={`Disconnect ${agent.label}`} onClick={() => void connect(agent, false)}>
                <Unplug className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                {busy === agent.id ? "Removing…" : "Disconnect"}
              </button>
            ) : (
              <button
                type="button"
                className="button button--primary"
                disabled={working || agent.unavailable !== null || confirming === agent.id}
                aria-label={`Connect ${agent.label}`}
                aria-expanded={confirming === agent.id}
                onClick={() => setConfirming(agent.id)}
              >
                <Plug className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                {busy === agent.id ? "Adding…" : "Connect"}
              </button>
            )}
          </div>
        </div>
        {CLI_OF[agent.id] && <AgentCli cli={CLI_OF[agent.id]!} />}
        {!agent.detected && DOWNLOAD[agent.id] && (
          <div className="cli__actions">
            <a className="button" href={DOWNLOAD[agent.id]!.url} target="_blank" rel="noreferrer">
              <Download className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              Get {agent.label}
            </a>
            <code className="cli__command">{DOWNLOAD[agent.id]!.site}</code>
          </div>
        )}
        {confirming === agent.id && (
          <div className="agents__confirm" role="group" aria-labelledby={`confirm-${agent.id}`}>
            <p id={`confirm-${agent.id}`} className="agents__ask">
              Add ClipCat to {agent.label}?
            </p>
            <p className="settings__body">
              ClipCat adds this entry to <span className="agents__file">{short(agent.config)}</span>. Nothing else in the file changes, and Disconnect
              takes it out again.
            </p>
            <pre className="agents__code">{agent.entry}</pre>
            <p className="settings__hint">
              There's no account to sign in to. {agent.label} starts a small ClipCat helper that talks to the open ClipCat app over a private
              connection only your user account on this computer can open. {ASKS[agent.id]}
            </p>
            <div className="settings__actions">
              <button type="button" className="button button--primary" onClick={() => void connect(agent, true)}>
                <Plug className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                Add to {agent.label}
              </button>
              <button type="button" className="button" onClick={() => setConfirming(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="notice notice--danger" role="alert">
            {error}
          </p>
        )}
        {steps && agent.connected && <Steps agent={agent} steps={steps} />}
      </li>
    );
  };

  // Apps on this computer (or already connected) come first; the rest wait
  // behind one line, so the list stays short for what's really installed.
  const found = (agents ?? []).filter((a) => a.detected || a.connected);
  const missing = (agents ?? []).filter((a) => !a.detected && !a.connected);

  return (
    <>
      <ul className="agents" aria-label="Coding agents">
        {found.map(row)}
      </ul>
      {missing.length > 0 && (
        <details className="agents__more" open={found.length === 0 || missing.some((a) => a.id === confirming || a.id === busy)}>
          <summary>Not found on this computer: {missing.map((a) => a.label).join(", ")}</summary>
          <ul className="agents" aria-label="Agents not found on this computer">
            {missing.map(row)}
          </ul>
        </details>
      )}
      <OtherApp />
    </>
  );
}
