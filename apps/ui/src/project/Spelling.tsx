import type { Project } from "@clipcat/core";
import { SpellCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";
import type { ProjectJobs } from "../useJobs";
import type { Ai } from "./useAi";

type Props = { project: Project; jobs: ProjectJobs; ai: Ai };

/**
 * The names and words transcription should spell right, kept for every
 * project, and a button that has the AI re-spell this transcript with them.
 */
export function Spelling({ project, jobs, ai }: Props) {
  const [terms, setTerms] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = jobs.active?.kind === "analyze" || jobs.active?.kind === "correct";
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  useEffect(() => {
    bridge()
      ?.invoke("settings:get")
      .then((s) => setTerms(s.dictionary.join(", ")), () => setTerms(""));
  }, []);

  const saveTerms = () => {
    if (terms === null) return;
    const dictionary = [...new Set(terms.split(/[,\n]/).map((t) => t.trim()).filter(Boolean))].slice(0, 200).map((t) => t.slice(0, 60));
    bridge()?.invoke("settings:set", { dictionary }).catch(fail);
  };
  const fix = () => {
    setError(null);
    saveTerms();
    bridge()?.invoke("project:correct", { id: project.id }).catch(fail);
  };

  return (
    <details className="spelling">
      <summary>Fix the spelling of names</summary>
      <label className="ai__label" htmlFor="spelling-terms">
        Names and words to spell right
      </label>
      <div className="ai__row">
        <input
          id="spelling-terms"
          className="ai__brief"
          placeholder="ClipCat, DaQuan, Vercel"
          value={terms ?? ""}
          disabled={terms === null}
          onChange={(e) => setTerms(e.target.value)}
          onBlur={saveTerms}
        />
        <button type="button" className="button" disabled={!ai.ready || running} onClick={fix}>
          <SpellCheck className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          {jobs.active?.kind === "correct" ? "Fixing…" : "Fix spelling"}
        </button>
      </div>
      <p className="ai__hint">{ai.reason ?? "Saved for every project. Fix spelling has your AI correct this transcript to match."}</p>
      {error && (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
