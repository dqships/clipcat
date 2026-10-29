import { AUTO_LANGUAGE, languageName } from "@clipcat/core";
import type { McpAgentValue, SettingsValue, UpdateStatusValue } from "@clipcat/ipc";
import { ArrowLeft, AudioLines, Bot, Download, FileArchive, FolderOpen, LifeBuoy, type LucideIcon, Plug, RefreshCw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";
import { useAi } from "../project/useAi";
import { AgentGuide } from "./AgentGuide";
import { Group, PageHead } from "./Group";
import { Agents } from "./Agents";
import { AiModels, aiShort } from "./AiModels";
import { Transcription } from "./Transcription";

/** The pages of Settings, in the order the list shows them. */
export const SECTIONS = ["ai", "agents", "transcription", "updates", "help"] as const;
export type SectionId = (typeof SECTIONS)[number];

type Props = {
  update: UpdateStatusValue | null;
  onBack: () => void;
  section?: SectionId;
  /** Opened from a project, so Back returns to it. */
  overProject?: boolean;
};

const message = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));

/** Where the last page opened is kept, so Settings opens where you left it. */
const REMEMBER = "clipcat.settings.section";

function remembered(): SectionId {
  try {
    const saved = localStorage.getItem(REMEMBER);
    return SECTIONS.find((s) => s === saved) ?? SECTIONS[0];
  } catch {
    return SECTIONS[0];
  }
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

/** The same, in a few words for the list. */
function updateShort(u: UpdateStatusValue | null): string {
  switch (u?.state) {
    case undefined:
    case "off":
      return "Doesn't update itself";
    case "checking":
      return "Checking…";
    case "downloading":
      return "Downloading…";
    case "ready":
      return `${u.version ?? "Update"} ready to install`;
    case "available":
      return `${u.version} is out`;
    case "error":
      return "Couldn't check";
    default:
      return "Up to date";
  }
}

function agentsShort(agents: McpAgentValue[] | null): string {
  if (!agents) return "Checking…";
  const connected = agents.filter((a) => a.connected).length;
  return connected === 0 ? "None connected" : `${connected} of ${agents.length} connected`;
}

function speechShort(prefs: SettingsValue | null): string {
  if (!prefs) return "Loading…";
  return prefs.speechLanguage === AUTO_LANGUAGE ? "Detects the language" : languageName(prefs.speechLanguage);
}

/**
 * Settings: a list of pages on the left, each with a word on where it
 * stands, and the open page on the right. The pages are which AI runs the
 * AI editor, hooking ClipCat into the coding agents on this computer, how speech is transcribed, updates,
 * and diagnostics.
 */
export function Settings({ update, onBack, section, overProject = false }: Props) {
  const [open, setOpen] = useState<SectionId>(() => section ?? remembered());
  const [agents, setAgents] = useState<McpAgentValue[] | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<SettingsValue | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ai = useAi();

  // The rows and the guide both follow the agents, including sessions they open while this screen is up.
  useEffect(() => {
    const api = bridge();
    if (!api) return;
    api.invoke("mcp:status").then(setAgents, (e: unknown) => setAgentsError(message(e)));
    api.invoke("settings:get").then(setPrefs, (e: unknown) => setPrefsError(message(e)));
    return api.on("mcp:agents", setAgents);
  }, []);

  useEffect(() => {
    if (section) setOpen(section);
  }, [section]);

  const go = (next: SectionId) => {
    setOpen(next);
    try {
      localStorage.setItem(REMEMBER, next);
    } catch {
      // Private storage is off: Settings just opens on the first page next time.
    }
  };

  const savePrefs = (patch: Partial<SettingsValue>) => {
    setPrefsError(null);
    setPrefs((p) => (p ? { ...p, ...patch } : p));
    bridge()
      ?.invoke("settings:set", patch)
      .then(setPrefs, (e: unknown) => setPrefsError(message(e)));
  };

  const saveDiagnostics = () => {
    setError(null);
    setSaving(true);
    bridge()
      ?.invoke("app:diagnostics")
      .then(({ path }) => setSaved(path), (e: unknown) => setError(message(e)))
      .finally(() => setSaving(false));
  };

  const pages: Record<SectionId, { label: string; icon: LucideIcon; status: string }> = {
    ai: { label: "AI editor", icon: Bot, status: aiShort(ai.status) },
    agents: { label: "Coding agents", icon: Plug, status: agentsShort(agents) },
    transcription: { label: "Transcription", icon: AudioLines, status: speechShort(prefs) },
    updates: { label: "Updates", icon: RefreshCw, status: updateShort(update) },
    help: { label: "Troubleshooting", icon: LifeBuoy, status: "Diagnostics and the log" },
  };

  return (
    <>
      <header className="titlebar">
        <button type="button" className="button button--icon" aria-label={overProject ? "Back to project" : "Back to library"} onClick={onBack}>
          <ArrowLeft className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
        </button>
        <h1 className="titlebar__title">Settings</h1>
      </header>
      <div className="settings">
        <nav className="settings__nav" aria-label="Settings">
          <ul className="settings__list">
            {SECTIONS.map((id) => {
              const { label, icon: Icon, status } = pages[id];
              return (
                <li key={id}>
                  <button type="button" className="settings__tab" aria-current={open === id ? "page" : undefined} onClick={() => go(id)}>
                    <Icon className="settings__tab-icon" strokeWidth={ICON_STROKE} aria-hidden />
                    <span className="settings__tab-name">{label}</span>
                    <span className="settings__tab-status">{status}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <main className="settings__page" key={open}>
          {open === "ai" && (
            <>
              <PageHead id="ai-title" title="AI editor">
                ClipCat has no AI service of its own. It uses the AI you pick here, which gets one tool for handing back suggestions and no access to
                your files, your terminal or the web.
              </PageHead>
              <AiModels ai={ai} />
            </>
          )}
          {open === "agents" && (
            <>
              <PageHead id="agents-title" title="Coding agents">
                Connect an agent and, while ClipCat is open, it can read your transcripts, cut words, accept suggested edits, add zooms, b-roll and
                sounds, and start exports. Every change shows up here and can be undone.
              </PageHead>
              <Group id="connections-title" label="Connections">
                {agentsError && (
                  <p className="notice notice--danger" role="alert">
                    {agentsError}
                  </p>
                )}
                <Agents agents={agents} onAgents={setAgents} />
              </Group>
              <AgentGuide agents={agents} />
            </>
          )}
          {open === "transcription" && (
            <>
              <PageHead id="transcription-title" title="Transcription">
                ClipCat transcribes on this computer. Nothing is uploaded.
              </PageHead>
              <Transcription prefs={prefs} onSave={savePrefs} error={prefsError} />
            </>
          )}
          {open === "updates" && (
            <>
              <PageHead id="updates-title" title="Updates">
                ClipCat checks for a new version when it opens and every four hours after.
              </PageHead>
              <Group id="version-title" label="This copy">
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
              </Group>
            </>
          )}
          {open === "help" && (
            <>
              <PageHead id="help-title" title="Troubleshooting">
                When something goes wrong, save the diagnostics and attach them to a bug report.
              </PageHead>
              <Group id="diagnostics-title" label="Diagnostics">
                <p className="settings__body">
                  Diagnostics are one zip: ClipCat's log, its versions and setup, recent jobs, each project's history and crash reports. It holds no
                  video, sound or transcript, so it's safe to attach to a bug report.
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
                {error && (
                  <p className="notice notice--danger" role="alert">
                    {error}
                  </p>
                )}
                {saved && <p className="settings__hint">Saved {saved.split(/[\\/]/).at(-1)}.</p>}
              </Group>
            </>
          )}
        </main>
      </div>
    </>
  );
}
