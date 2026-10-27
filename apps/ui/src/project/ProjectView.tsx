import type { Project } from "@clipcat/core";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";
import { formatDuration, mediaUrl } from "../format";
import { ICON_STROKE } from "../icons";
import { JobLine } from "../JobLine";
import { type ProjectJobs, useProjectChanges } from "../useJobs";
import { AiPanel } from "./AiPanel";

type Props = { projectId: string; jobs: ProjectJobs; onBack: () => void };

/**
 * A project as it comes out of import: the proxy, the transcript, the pauses
 * found and the AI's proposed cuts, which show struck through in the
 * transcript. Read-only for now; the transcript editor replaces the right
 * column in milestone 1c.
 */
export function ProjectView({ projectId, jobs, onBack }: Props) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  const load = useCallback(
    (id: string) => {
      if (id !== projectId) return;
      bridge()
        ?.invoke("project:get", { id })
        .then(setProject, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    },
    [projectId],
  );
  useEffect(() => load(projectId), [load, projectId]);
  useProjectChanges(load);

  const source = project?.sources[0];
  const words = project?.transcript.filter((w) => w.sourceId === source?.id) ?? [];
  const pauses = project?.proposals.filter((p) => p.type === "silence" && p.sourceId === source?.id) ?? [];
  const cutSeconds = pauses.reduce((n, p) => n + p.cuts.reduce((m, [a, b]) => m + (b - a), 0), 0);
  const proposed = new Set(project?.proposals.filter((p) => p.type !== "silence" && p.status === "pending").flatMap((p) => p.wordIds));
  const seek = (t: number) => {
    if (video.current) video.current.currentTime = t;
  };

  return (
    <>
      <header className="titlebar">
        <button type="button" className="button button--icon" aria-label="Back to library" onClick={onBack}>
          <ArrowLeft className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
        </button>
        <h1 className="titlebar__title">{project?.name ?? "Project"}</h1>
      </header>
      <main className="project">
        {error && (
          <p className="notice notice--danger" role="alert">
            {error}
          </p>
        )}
        <section className="project__preview" aria-label="Preview">
          {source?.prep ? (
            <video ref={video} className="project__video" src={mediaUrl(projectId, source.prep.proxy)} controls preload="metadata" />
          ) : (
            <div className="project__video project__video--pending" />
          )}
          <JobLine jobs={jobs} />
          {project && <AiPanel project={project} jobs={jobs} onSeek={seek} />}
        </section>
        <section className="project__transcript" aria-labelledby="transcript-title">
          <h2 id="transcript-title" className="section-title">
            Transcript
          </h2>
          {pauses.length > 0 && (
            <p className="project__summary">
              {pauses.length} {pauses.length === 1 ? "pause" : "pauses"} found, {formatDuration(cutSeconds)} to cut.
            </p>
          )}
          {words.length > 0 ? (
            <p className="transcript">
              {words.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className={proposed.has(w.id) ? "word word--proposed" : "word"}
                  onClick={() => seek(w.start)}
                >
                  {w.text}
                </button>
              ))}
            </p>
          ) : (
            <p className="empty__body">{source?.transcription ? "No speech found." : "The transcript appears here once it's ready."}</p>
          )}
        </section>
      </main>
    </>
  );
}
