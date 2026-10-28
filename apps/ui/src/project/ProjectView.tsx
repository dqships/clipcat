import type { Project } from "@clipcat/core";
import { ArrowLeft, Redo2, Undo2, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";
import { JobLine } from "../JobLine";
import { type ProjectJobs, useProjectChanges } from "../useJobs";
import { AiPanel } from "./AiPanel";
import { CaptionOverlay } from "./CaptionOverlay";
import { CaptionsPanel } from "./CaptionsPanel";
import { ExportPanel } from "./ExportPanel";
import { FramingPanel } from "./FramingPanel";
import { MediaPanel } from "./MediaPanel";
import { type Playhead, Preview, type PreviewHandle } from "./Preview";
import { Proposals } from "./Proposals";
import { PunchInsPanel } from "./PunchInsPanel";
import { ShortsPanel } from "./ShortsPanel";
import { SoundPanel } from "./SoundPanel";
import { Waveform } from "./Waveform";
import { Transcript } from "./Transcript";
import { useEditor } from "./useEditor";
import { ThumbnailPanel } from "./ThumbnailPanel";
import { WriteupPanel } from "./WriteupPanel";

type Props = {
  projectId: string;
  jobs: ProjectJobs;
  onBack: () => void;
  onOpen: (id: string) => void;
  /** Records another take into this project. */
  onRecord: (name: string | null) => void;
};

/**
 * The editor: the preview plays the edit, the strip shows where the cuts
 * are, and the transcript is where they're made. Suggested edits, from the
 * pause finder and from Claude, wait below the preview for a decision;
 * caption style and export come after.
 */
export function ProjectView({ projectId, jobs, onBack, onOpen, onRecord }: Props) {
  const [project, setProjectState] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState<Playhead | null>(null);
  const preview = useRef<PreviewHandle>(null);

  // Loads and edits can finish out of order; never go back to an older revision.
  const setProject = useCallback((next: Project) => {
    setProjectState((prev) => (prev && prev.id === next.id && prev.revision > next.revision ? prev : next));
  }, []);

  const load = useCallback(
    (id: string) => {
      if (id !== projectId) return;
      bridge()
        ?.invoke("project:get", { id })
        .then(setProject, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    },
    [projectId, setProject],
  );
  useEffect(() => load(projectId), [load, projectId]);
  useProjectChanges(load);
  const reload = useCallback(() => load(projectId), [load, projectId]);
  const edit = useEditor(project, setProject, reload, setError);

  const seek = useCallback((sourceId: string, time: number) => {
    preview.current?.seek(sourceId, time);
    setPlayhead({ sourceId, time });
  }, []);

  const hasWords = (project?.transcript.length ?? 0) > 0;
  const transcribed = project?.sources.some((s) => s.transcription) ?? false;

  return (
    <>
      <header className="titlebar">
        <button type="button" className="button button--icon" aria-label="Back to library" onClick={onBack}>
          <ArrowLeft className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
        </button>
        <h1 className="titlebar__title">{project?.name ?? "Project"}</h1>
        <div className="titlebar__action">
          <button
            type="button"
            className="button button--icon"
            aria-label="Record another take"
            title="Record another take"
            onClick={() => onRecord(project?.name ?? null)}
          >
            <Video className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          </button>
          <button
            type="button"
            className="button button--icon"
            aria-label="Undo"
            title="Undo"
            disabled={!project?.history.past.length}
            onClick={() => edit({ type: "undo" })}
          >
            <Undo2 className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          </button>
          <button
            type="button"
            className="button button--icon"
            aria-label="Redo"
            title="Redo"
            disabled={!project?.history.future.length}
            onClick={() => edit({ type: "redo" })}
          >
            <Redo2 className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>
      </header>
      <main className="project">
        {error && (
          <p className="notice notice--danger" role="alert">
            {error}
          </p>
        )}
        <section className="project__preview" aria-label="Preview">
          {project ? (
            <div className={project.aspectRatio === "9:16" ? "stage stage--tall" : "stage"}>
              <Preview ref={preview} project={project} onTime={setPlayhead} />
              <CaptionOverlay project={project} playhead={playhead} />
            </div>
          ) : (
            <div className="project__video project__video--pending" />
          )}
          {project && <Waveform project={project} playhead={playhead} onSeek={seek} />}
          <JobLine jobs={jobs} onCancel={() => void bridge()?.invoke("jobs:cancel", { id: projectId })} />
          {project && <Proposals project={project} onSeek={seek} onEdit={edit} />}
          {project && <PunchInsPanel project={project} onSeek={seek} onEdit={edit} />}
          {project && <MediaPanel project={project} onSeek={seek} onEdit={edit} />}
          {project && <SoundPanel project={project} onSeek={seek} onEdit={edit} />}
          {project && <AiPanel project={project} jobs={jobs} />}
          {project && <ShortsPanel project={project} jobs={jobs} onOpen={onOpen} />}
          {project && <WriteupPanel project={project} jobs={jobs} onSeek={seek} onEdit={edit} />}
          {project && <ThumbnailPanel project={project} playhead={playhead} jobs={jobs} onEdit={edit} />}
          {project && <FramingPanel project={project} playhead={playhead} onEdit={edit} />}
          {project && <CaptionsPanel project={project} onEdit={edit} />}
          {project && <ExportPanel project={project} jobs={jobs} onEdit={edit} />}
        </section>
        <section className="project__transcript" aria-labelledby="transcript-title">
          <h2 id="transcript-title" className="section-title">
            Transcript
          </h2>
          {project && hasWords ? (
            <Transcript project={project} playhead={playhead} onSeek={seek} onEdit={edit} />
          ) : (
            <p className="empty__body">{transcribed ? "No speech found." : "The transcript appears here once it's ready."}</p>
          )}
        </section>
      </main>
    </>
  );
}
