import type { ProjectSummaryValue } from "@clipcat/ipc";
import { Ellipsis, FolderOpen, Pencil, SquarePlay, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { formatDuration, mediaUrl } from "../format";
import { ICON_STROKE } from "../icons";
import { JobLine } from "../JobLine";
import { Menu, type MenuItem, useMenuTrigger } from "../Menu";
import { NameField } from "../NameField";
import type { ProjectJobs } from "../useJobs";

type Props = {
  project: ProjectSummaryValue;
  jobs: ProjectJobs;
  onOpen: () => void;
  onRename: (name: string) => void;
  onReveal: () => void;
  onRemove: () => void;
};

/** Finder on a Mac, Explorer on Windows. */
export const revealLabel = () => (/Windows/.test(navigator.userAgent ?? "") ? "Show in Explorer" : "Show in Finder");

/** One project in the library. Right-click it, press and hold, or use its options button for the rest. */
export function ProjectCard({ project, jobs, onOpen, onRename, onReveal, onRemove }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setMenuAt(null), []);
  const trigger = useMenuTrigger(setMenuAt);
  const videos = project.sources === 1 ? "1 video" : `${project.sources} videos`;
  const items: MenuItem[] = [
    { label: "Open", icon: SquarePlay, onSelect: onOpen },
    { label: "Rename", icon: Pencil, onSelect: () => setRenaming(true) },
    { label: revealLabel(), icon: FolderOpen, onSelect: onReveal },
    { label: "Delete", icon: Trash2, onSelect: () => setConfirming(true), danger: true },
  ];
  return (
    <article className="card" {...(renaming ? {} : trigger)}>
      <div className="card__thumb">{project.thumb && <img src={mediaUrl(project.id, project.thumb)} alt="" />}</div>
      <h2 className="card__title">
        {renaming ? (
          <NameField name={project.name} label="Project name" onRename={onRename} onDone={() => setRenaming(false)} />
        ) : (
          <button type="button" className="card__open" onClick={onOpen}>
            {project.name}
          </button>
        )}
      </h2>
      <p className="card__meta">
        {project.origin ? `Short from ${project.origin}` : `${formatDuration(project.duration)} · ${videos}`}
      </p>
      <JobLine jobs={jobs} />
      <div className="card__actions">
        {confirming ? (
          <>
            <button type="button" className="button button--danger" onClick={onRemove}>
              Delete project
            </button>
            <button type="button" className="button" onClick={() => setConfirming(false)}>
              Keep project
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button button--icon"
            aria-label={`Options for ${project.name}`}
            aria-haspopup="menu"
            aria-expanded={menuAt !== null}
            title="Options"
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              setMenuAt({ x: box.left, y: box.bottom });
            }}
          >
            <Ellipsis className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        )}
      </div>
      {menuAt && <Menu label={`Options for ${project.name}`} at={menuAt} items={items} onClose={close} />}
    </article>
  );
}
