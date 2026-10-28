import type { Project } from "@clipcat/core";
import { ArrowUpRight, Smartphone } from "lucide-react";
import { useState } from "react";
import { bridge } from "../bridge";
import { formatDuration } from "../format";
import { ICON_STROKE } from "../icons";
import type { ProjectJobs } from "../useJobs";

type Props = { project: Project; jobs: ProjectJobs; onOpen: (id: string) => void };

const COUNTS = [1, 3, 5] as const;
const LENGTHS = [30, 60, 90] as const;

/**
 * Shorts from a long video: the AI editor picks the moments that stand on
 * their own, and each becomes a vertical project to edit and export. In a
 * short, this says where it came from instead.
 */
export function ShortsPanel({ project, jobs, onOpen }: Props) {
  const [count, setCount] = useState<(typeof COUNTS)[number]>(3);
  const [seconds, setSeconds] = useState<(typeof LENGTHS)[number]>(60);
  const [error, setError] = useState<string | null>(null);
  const running = jobs.active?.kind === "shorts";
  const hasWords = project.transcript.length > 0;

  if (project.origin) {
    const { origin } = project;
    return (
      <section className="panel" aria-labelledby="shorts-title">
        <h2 id="shorts-title" className="section-title">
          Short
        </h2>
        <p className="shorts__origin">
          <span>
            Cut from {origin.name}. {origin.reason}
          </span>
          <button type="button" className="button" onClick={() => onOpen(origin.projectId)}>
            <ArrowUpRight className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
            Open the long video
          </button>
        </p>
      </section>
    );
  }

  const make = () => {
    setError(null);
    bridge()
      ?.invoke("project:shorts", { id: project.id, count, seconds })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <section className="panel" aria-labelledby="shorts-title">
      <h2 id="shorts-title" className="section-title">
        Shorts
      </h2>
      <p className="project__summary">The AI editor picks the moments that stand on their own. Each one becomes a vertical project you can edit and export. If there aren't enough good moments, you get fewer.</p>
      <div className="shorts__controls">
        <label className="field">
          <span className="field__label">How many</span>
          <select className="field__control" value={count} disabled={running} onChange={(e) => setCount(Number(e.target.value) as typeof count)}>
            {COUNTS.map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "1 short" : `Up to ${n}`}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Length</span>
          <select className="field__control" value={seconds} disabled={running} onChange={(e) => setSeconds(Number(e.target.value) as typeof seconds)}>
            {LENGTHS.map((s) => (
              <option key={s} value={s}>
                Up to {s} s
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="button" disabled={!hasWords || running} onClick={make}>
          <Smartphone className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          {running ? "Finding shorts…" : "Make shorts"}
        </button>
        {!hasWords && <span className="ai__hint">Available once the transcript is ready.</span>}
      </div>
      {error && (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      )}
      {project.shorts.length > 0 && (
        <ul className="shorts" aria-label="Shorts from this video">
          {project.shorts.map((s) => (
            <li key={s.id} className="shorts__item">
              <span className="shorts__title">{s.title}</span>
              <span className="shorts__length">{formatDuration(s.seconds)}</span>
              <button type="button" className="button" aria-label={`Open ${s.title}`} onClick={() => onOpen(s.id)}>
                <ArrowUpRight className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
