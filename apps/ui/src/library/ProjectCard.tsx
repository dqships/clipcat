import type { ProjectSummaryValue } from "@clipcat/ipc";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { formatDuration, mediaUrl } from "../format";
import { ICON_STROKE } from "../icons";
import { JobLine } from "../JobLine";
import type { ProjectJobs } from "../useJobs";

type Props = { project: ProjectSummaryValue; jobs: ProjectJobs; onOpen: () => void; onRemove: () => void };

export function ProjectCard({ project, jobs, onOpen, onRemove }: Props) {
  const [confirming, setConfirming] = useState(false);
  const videos = project.sources === 1 ? "1 video" : `${project.sources} videos`;
  return (
    <article className="card">
      <div className="card__thumb">{project.thumb && <img src={mediaUrl(project.id, project.thumb)} alt="" />}</div>
      <h2 className="card__title">
        <button type="button" className="card__open" onClick={onOpen}>
          {project.name}
        </button>
      </h2>
      <p className="card__meta">
        {formatDuration(project.duration)} · {videos}
      </p>
      <JobLine jobs={jobs} />
      <div className="card__actions">
        {confirming ? (
          <>
            <button type="button" className="button button--danger" onClick={onRemove}>
              Delete project
            </button>
            <button type="button" className="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="button button--icon" aria-label={`Delete ${project.name}`} onClick={() => setConfirming(true)}>
            <Trash2 className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        )}
      </div>
    </article>
  );
}
