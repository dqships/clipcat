import { type EditOp, type Project, buildTimeline } from "@clipcat/core";
import { Download, FolderOpen } from "lucide-react";
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

const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1, 1.2, 1.25, 1.5, 1.75, 2];

/** Renders the edit to an MP4 (and an SRT beside it) wherever the user saves it. */
export function ExportPanel({ project, jobs, onEdit }: Props) {
  const [error, setError] = useState<string | null>(null);
  const duration = buildTimeline(project).duration;
  const exporting = jobs.active?.kind === "export";
  const ready = project.sources.length > 0 && project.sources.every((s) => s.prep) && duration > 0;
  const last = project.lastExport;

  const start = (format: "16:9" | "9:16") => {
    setError(null);
    bridge()
      ?.invoke("project:export", { id: project.id, format })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
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
        <span className="field__label">Speed</span>
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
