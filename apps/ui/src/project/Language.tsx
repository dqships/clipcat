import { languageName, type Project } from "@clipcat/core";
import { Languages } from "lucide-react";
import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";
import { LanguageOptions } from "../settings/Transcription";
import type { ProjectJobs } from "../useJobs";

type Props = { project: Project; jobs: ProjectJobs };

/** The language this project's speech is in, and transcribing it again in another one. */
export function Language({ project, jobs }: Props) {
  const [language, setLanguage] = useState(project.language);
  const [error, setError] = useState<string | null>(null);
  const transcribing = jobs.active?.kind === "transcribe" || jobs.active?.kind === "prep";

  useEffect(() => setLanguage(project.language), [project.language]);

  const transcribe = () => {
    setError(null);
    bridge()
      ?.invoke("project:language", { id: project.id, language })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <details className="spelling">
      <summary>Language: {languageName(project.language)}</summary>
      <div className="ai__row">
        <select
          className="field__control"
          aria-label="Language of the speech"
          value={language}
          disabled={transcribing}
          onChange={(e) => setLanguage(e.target.value)}
        >
          <LanguageOptions />
        </select>
        <button type="button" className="button" disabled={transcribing} onClick={transcribe}>
          <Languages className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          {transcribing ? "Transcribing…" : "Transcribe again"}
        </button>
      </div>
      <p className="ai__hint">
        This replaces the transcript, including words you fixed, and clears suggested edits you haven't reviewed. Cuts you made stay.
      </p>
      {error && (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
