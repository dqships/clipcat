import type { Project } from "@clipcat/core";
import { ArrowLeft, Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";
import { JobLine } from "../JobLine";
import { type ProjectJobs, useProjectChanges } from "../useJobs";
import { AiPanel } from "./AiPanel";
import { CaptionOverlay } from "./CaptionOverlay";
import { CaptionsPanel } from "./CaptionsPanel";
import { ExportPanel } from "./ExportPanel";
import { type Playhead, Preview, type PreviewHandle } from "./Preview";
import { Proposals } from "./Proposals";
import { Waveform } from "./Waveform";
import { Transcript } from "./Transcript";
import { useEditor } from "./useEditor";

type Props = { projectId: string; jobs: ProjectJobs; onBack: () => void };

/**
 * The editor: the preview plays the edit, the strip shows where the cuts
 * are, and the transcript is where they're made. Suggested cuts, from the
 * pause finder and from Claude, wait below the preview for a decision;
 * caption style and export come after.
 */
export function ProjectView({ projectId, jobs, onBack }: Props) {
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
            <div className="stage">
              <Preview ref={preview} project={project} onTime={setPlayhead} />
              <CaptionOverlay project={project} playhead={playhead} />
            </div>
          ) : (
            <div className="project__video project__video--pending" />
          )}
          {project && <Waveform project={project} playhead={playhead} onSeek={seek} />}
          <JobLine jobs={jobs} />
          {project && <Proposals project={project} onSeek={seek} onEdit={edit} />}
          {project && <AiPanel project={project} jobs={jobs} />}
          {project && <CaptionsPanel project={project} onEdit={edit} />}
          {project && <ExportPanel project={project} jobs={jobs} />}
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
