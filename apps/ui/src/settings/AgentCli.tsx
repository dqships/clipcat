import type { CliIdValue, CliStatusValue } from "@clipcat/ipc";
import { Download, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";

type Props = { cli: CliIdValue };

const message = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));

/** One sentence on the installed copy against the newest release. */
function versionText(s: CliStatusValue): string {
  if (!s.path) return `The ${s.label} command-line tool isn't installed.${s.latest ? ` The newest is ${s.latest}.` : ""}`;
  if (!s.version) return `${s.label} is installed but didn't say its version, so it may be broken.`;
  if (!s.latest) return `Version ${s.version}. Couldn't check for a newer one.`;
  return s.action === "update" || s.manual ? `Version ${s.version}. ${s.latest} is out.` : `Version ${s.version}, the newest.`;
}

/**
 * The CLI behind an agent row in Settings: its version against the newest,
 * a warning when it's out of step with the config it shares, and a button
 * that installs or updates it the official way, with the installer's own
 * progress shown as it runs.
 */
export function AgentCli({ cli }: Props) {
  const [status, setStatus] = useState<CliStatusValue | null>(null);
  const [running, setRunning] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const api = bridge();
    if (!api) return;
    void api.invoke("cli:status", { id: cli }).then(setStatus, (e: unknown) => setError(message(e)));
    return api.on("cli:progress", (p) => {
      if (p.id === cli) setLine(p.line);
    });
  }, [cli]);

  const run = () => {
    if (!status) return;
    const installing = status.action === "install";
    setError(null);
    setDone(null);
    setLine(null);
    setRunning(true);
    bridge()
      ?.invoke("cli:run", { id: cli })
      .then(
        (after) => {
          setStatus(after);
          setDone(after.version ? `${installing ? "Installed" : "Updated to"} ${after.label} ${after.version}.` : `${after.label} finished, but ClipCat can't find it yet. Reopen ClipCat.`);
        },
        (e: unknown) => setError(message(e)),
      )
      .finally(() => {
        setRunning(false);
        setLine(null);
      });
  };

  if (!status) {
    return (
      <div className="cli">
        <p className="cli__version">{error ?? "Checking the installed version…"}</p>
      </div>
    );
  }

  const label = status.action === "install" ? `Install ${status.label}` : `Update to ${status.latest ?? "the newest"}`;
  return (
    <div className="cli">
      <p className="cli__version">{versionText(status)}</p>
      {status.warning && (
        <p className="cli__warning" role="note">
          <TriangleAlert className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          <span>{status.warning}</span>
        </p>
      )}
      {status.manual && <p className="cli__version">{status.manual}</p>}
      {status.action && (
        <div className="cli__actions">
          <button type="button" className="button" disabled={running} onClick={run}>
            {status.action === "install" ? (
              <Download className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
            ) : (
              <RefreshCw className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
            )}
            {running ? (status.action === "install" ? "Installing…" : "Updating…") : label}
          </button>
          {status.command && (
            <code className="cli__command" title="What the button runs">
              {status.command}
            </code>
          )}
        </div>
      )}
      {running && (
        <p className="cli__progress" role="status" aria-live="polite">
          {line ?? "Starting…"}
        </p>
      )}
      {error && (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="cli__version" role="status">
          {done}
        </p>
      )}
    </div>
  );
}
