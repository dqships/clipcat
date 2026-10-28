import type { ProjectSummaryValue } from "@clipcat/ipc";
import { Plus, Settings, Video } from "lucide-react";
import { type DragEvent, useCallback, useEffect, useState } from "react";
import lockupInk from "../../../../brand/logo/clipcat-lockup-ink.svg";
import lockupWhite from "../../../../brand/logo/clipcat-lockup-white.svg";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";
import { type ProjectJobs, useProjectChanges } from "../useJobs";
import { EmptyStrip } from "./EmptyStrip";
import { ProjectCard } from "./ProjectCard";

type Props = {
  jobsFor: (projectId: string) => ProjectJobs;
  onOpen: (projectId: string) => void;
  onSettings: () => void;
  onRecord: () => void;
};

/** The first screen: your projects, newest first. Drop files anywhere to start one. */
export function Library({ jobsFor, onOpen, onSettings, onRecord }: Props) {
  const [projects, setProjects] = useState<ProjectSummaryValue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const refresh = useCallback(() => {
    const api = bridge();
    if (!api) return setProjects([]);
    api.invoke("library:list").then(setProjects, (e: unknown) => setError(message(e)));
  }, []);
  useEffect(refresh, [refresh]);
  useProjectChanges(refresh);

  const importFiles = async (files: string[]) => {
    const api = bridge();
    if (!api || files.length === 0) return;
    setError(null);
    try {
      await api.invoke("project:import", { projectId: null, files });
      refresh();
    } catch (e) {
      setError(message(e));
    }
  };

  const pick = async () => {
    const api = bridge();
    if (api) await importFiles(await api.invoke("files:pick"));
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const api = bridge();
    if (!api) return;
    void importFiles([...event.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean));
  };

  const remove = async (id: string) => {
    await bridge()?.invoke("project:remove", { id });
    refresh();
  };

  // Nothing is drawn for the list until it has loaded, so the empty state doesn't flash.
  const empty = projects !== null && projects.length === 0;
  const hasProjects = projects !== null && projects.length > 0;
  return (
    <>
      <header className="titlebar">
        <picture>
          <source srcSet={lockupWhite} media="(prefers-color-scheme: dark)" />
          <img className="titlebar__logo" src={lockupInk} alt="ClipCat" />
        </picture>
        <div className="titlebar__action">
          {hasProjects && (
            <button type="button" className="button" onClick={onRecord}>
              <Video className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              Record
            </button>
          )}
          {hasProjects && (
            <button type="button" className="button button--primary" onClick={pick}>
              <Plus className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              Add videos
            </button>
          )}
          <button type="button" className="button button--icon" aria-label="Settings" title="Settings" onClick={onSettings}>
            <Settings className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>
      </header>
      <main
        className={dragging ? "library library--dragging" : "library"}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={onDrop}
      >
        <h1 className="visually-hidden">Library</h1>
        {error && (
          <p className="notice notice--danger" role="alert">
            {error}
          </p>
        )}
        {empty ? (
          <section className="empty" aria-labelledby="empty-title">
            <EmptyStrip />
            <h2 id="empty-title" className="empty__title">
              No projects yet
            </h2>
            <p className="empty__body">
              Add videos or record a take. ClipCat transcribes it on your computer, then your AI suggests cuts for you to review.
            </p>
            <div className="empty__actions">
              <button type="button" className="button button--primary" onClick={pick}>
                <Plus className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                Add videos
              </button>
              <button type="button" className="button" onClick={onRecord}>
                <Video className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                Record
              </button>
            </div>
          </section>
        ) : (
          <ul className="grid" aria-label="Projects">
            {(projects ?? []).map((p) => (
              <li key={p.id}>
                <ProjectCard project={p} jobs={jobsFor(p.id)} onOpen={() => onOpen(p.id)} onRemove={() => remove(p.id)} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

const message = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));
