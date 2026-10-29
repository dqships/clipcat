import { AUTO_LANGUAGE, languagesByName } from "@clipcat/core";
import type { SettingsValue, SpeechModelIdValue, SpeechModelValue } from "@clipcat/ipc";
import { Download, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";
import { Group } from "./Group";

type Speech = Pick<SettingsValue, "speechLanguage" | "speechEngine" | "whisperModel">;

type Props = { prefs: Speech | null; onSave: (patch: Partial<Speech>) => void; error: string | null };

const message = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));

const size = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

/** The language list for a picker: auto first, then every language by name. */
export function LanguageOptions() {
  return (
    <>
      <option value={AUTO_LANGUAGE}>Detect automatically</option>
      {languagesByName().map((l) => (
        <option key={l.code} value={l.code}>
          {l.name}
        </option>
      ))}
    </>
  );
}

/**
 * Transcription settings: the language new projects start in, which engine
 * and whisper model hear the speech, and the models on disk, which can be
 * downloaded ahead of time or deleted to free the space. Settings owns the
 * saved choices, so its list shows the language too.
 */
export function Transcription({ prefs, onSave: save, error: saveError }: Props) {
  const [models, setModels] = useState<SpeechModelValue[] | null>(null);
  const [busy, setBusy] = useState<SpeechModelIdValue | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failure, setError] = useState<string | null>(null);
  const error = failure ?? saveError;

  useEffect(() => {
    const api = bridge();
    if (!api) return;
    api.invoke("speech:models").then(setModels, (e: unknown) => setError(message(e)));
    return api.on("speech:progress", ({ fraction }) => setProgress(fraction));
  }, []);

  const run = (id: SpeechModelIdValue, method: "speech:download" | "speech:remove") => {
    setError(null);
    setBusy(id);
    setProgress(0);
    bridge()
      ?.invoke(method, { id })
      .then(setModels, (e: unknown) => setError(message(e)))
      .finally(() => setBusy(null));
  };

  const parakeet = models?.some((m) => m.id === "parakeet") ?? false;

  return (
    <>
      <Group id="speech-title" label="New projects">
        <p className="settings__body">
          {parakeet
            ? "Parakeet hears 25 European languages and is the fastest. Whisper hears about 100 languages and takes the rest."
            : "Whisper hears about 100 languages."}
        </p>
        <div className="fields">
          <label className="field">
            <span className="field__label">Language for new projects</span>
            <select
              className="field__control"
              value={prefs?.speechLanguage ?? "en"}
              disabled={!prefs}
              onChange={(e) => save({ speechLanguage: e.target.value })}
            >
              <LanguageOptions />
            </select>
          </label>
          <label className="field">
            <span className="field__label">Whisper model</span>
            <select
              className="field__control"
              value={prefs?.whisperModel ?? "large-v3-turbo-q5_0"}
              disabled={!prefs}
              onChange={(e) => save({ whisperModel: e.target.value as Speech["whisperModel"] })}
            >
              <option value="large-v3-turbo-q5_0">Large v3 Turbo (most accurate)</option>
              <option value="base">Base (fastest, less accurate)</option>
            </select>
          </label>
          {parakeet && (
            <label className="field">
              <span className="field__label">Engine</span>
              <select
                className="field__control"
                value={prefs?.speechEngine ?? "auto"}
                disabled={!prefs}
                onChange={(e) => save({ speechEngine: e.target.value as Speech["speechEngine"] })}
              >
                <option value="auto">Parakeet when it knows the language</option>
                <option value="whisper">Always whisper</option>
              </select>
            </label>
          )}
        </div>
        <p className="settings__hint">
          Detect automatically lets whisper guess the language from the first seconds of speech, so it skips Parakeet. Each project can change its
          language from the transcript.
        </p>
      </Group>
      <Group id="models-title" label="Speech models on this computer">
        <ul className="agents" aria-label="Speech models">
          {models?.map((m) => (
            <li key={m.id} className="agents__item">
              <div className="agents__row">
                <div className="agents__text">
                  <span className="agents__name">{m.label}</span>
                  <span className="agents__path" role="status">
                    {busy === m.id && m.downloaded === false
                      ? progress === null
                        ? "Preparing…"
                        : `Downloading… ${Math.round(progress * 100)}%`
                      : m.downloaded
                        ? `Downloaded, ${size(m.bytes)}`
                        : `Not downloaded, about ${m.approxMB} MB. It downloads the first time it's needed.`}
                  </span>
                </div>
                <div className="agents__actions">
                  {m.downloaded ? (
                    <button type="button" className="button" disabled={busy !== null} aria-label={`Delete ${m.label}`} onClick={() => run(m.id, "speech:remove")}>
                      <Trash2 className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                      Delete
                    </button>
                  ) : (
                    <button type="button" className="button" disabled={busy !== null} aria-label={`Download ${m.label}`} onClick={() => run(m.id, "speech:download")}>
                      <Download className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                      Download
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="settings__hint">A model is loaded only while it transcribes and lets go of the memory when it's done.</p>
        {error && (
          <p className="notice notice--danger" role="alert">
            {error}
          </p>
        )}
      </Group>
    </>
  );
}
