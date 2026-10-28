import { type EditOp, type Project, buildTimeline } from "@clipcat/core";
import { Download, FileOutput, FolderOpen } from "lucide-react";
import { useState } from "react";
import { bridge } from "../bridge";
import { formatDuration } from "../format";
import { ICON_STROKE } from "../icons";
import type { ProjectJobs } from "../useJobs";

type Props = { project: Project; jobs: ProjectJobs; onEdit: (op: EditOp) => void };

const FORMATS = [
  { format: "16:9", label: "Export 16:9", hint: "Landscape, up to 1440p" },
  { format: "9:16", label: "Export 9:16", hint: "Vertical 1080×1920, cropped around you" },
] as const;

const TIMELINES = [
  { format: "fcpxml", label: "Final Cut Pro", hint: ".fcpxml, also opens in Resolve" },
  { format: "premiere", label: "Premiere Pro", hint: ".xml, also opens in Resolve" },
  { format: "edl", label: "EDL", hint: ".edl, for any editor" },
] as const;

const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1, 1.2, 1.25, 1.5, 1.75, 2];

/** Renders the edit to an MP4 (and an SRT beside it) wherever the user saves it. */
export function ExportPanel({ project, jobs, onEdit }: Props) {
  const [error, setError] = useState<string | null>(null);
  const duration = buildTimeline(project).duration;
  const exporting = jobs.active?.kind === "export";
  const ready = project.sources.length > 0 && project.sources.every((s) => s.prep) && duration > 0;
  const last = project.lastExport;
  const [timeline, setTimeline] = useState<string | null>(null);

  const start = (format: "16:9" | "9:16") => {
    setError(null);
    bridge()
      ?.invoke("project:export", { id: project.id, format })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const saveTimeline = (format: (typeof TIMELINES)[number]["format"]) => {
    setError(null);
    bridge()
      ?.invoke("project:export-timeline", { id: project.id, format })
      .then(
        ({ path }) => path && setTimeline(path.split(/[\\/]/).at(-1) ?? path),
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      );
  };

  return (
    <section className="panel" aria-labelledby="export-title">
      <h2 id="export-title" className="section-title">
        Export
      </h2>
      <p className="project__summary">
        {duration > 0 ? `The edit runs ${formatDuration(duration)}.` : "Everything is cut, so there is nothing to export."}
      </p>
      <label className="field">
        <span className="field__label">Playback speed</span>
        <select
          className="field__control"
          value={project.speed}
          disabled={exporting}
          onChange={(e) => onEdit({ type: "speed", speed: Number(e.target.value) })}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s === 1 ? "Normal (1×)" : `${s}×`}
            </option>
          ))}
        </select>
      </label>
      <div className="export">
        {FORMATS.map((f) => (
          <button key={f.format} type="button" className="button export__option" disabled={!ready || exporting} onClick={() => start(f.format)}>
            <Download className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
            <span>
              {f.label}
              <span className="export__hint">{f.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <h3 className="export__subtitle">Finish in another editor</h3>
      <p className="export__note">The cut as a timeline of your original recordings, at normal speed, with chapters as markers. Captions and effects stay in ClipCat.</p>
      <div className="export export--timelines">
        {TIMELINES.map((t) => (
          <button key={t.format} type="button" className="button export__option" disabled={duration <= 0} onClick={() => saveTimeline(t.format)}>
            <FileOutput className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
            <span>
              {t.label}
              <span className="export__hint">{t.hint}</span>
            </span>
          </button>
        ))}
      </div>
      {timeline && (
        <p className="export__note" role="status">
          Saved {timeline}.
        </p>
      )}
      {error && (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      )}
      {last && (
        <p className="export__last">
          <span>
            Last export: {last.path.split(/[\\/]/).at(-1)} ({last.format})
          </span>
          <button type="button" className="button" onClick={() => void bridge()?.invoke("project:reveal-export", { id: project.id })}>
            <FolderOpen className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
            Show file
          </button>
        </p>
      )}
    </section>
  );
}
