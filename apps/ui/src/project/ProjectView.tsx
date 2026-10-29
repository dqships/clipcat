import type { Project } from "@clipcat/core";
import { ArrowLeft, Eye, EyeOff, Redo2, Undo2, Video } from "lucide-react";
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
import { useHideCuts } from "./hiddenCuts";
import { MediaPanel } from "./MediaPanel";
import { type Playhead, Preview, type PreviewHandle, type Transport } from "./Preview";
import { Proposals } from "./Proposals";
import { PunchInsPanel } from "./PunchInsPanel";
import { ShortsPanel } from "./ShortsPanel";
import { SoundPanel } from "./SoundPanel";
import { Spelling } from "./Spelling";
import { Tools } from "./Tools";
import { TransportBar } from "./TransportBar";
import { Waveform } from "./Waveform";
import { Transcript } from "./Transcript";
import { type Dock, type PanelId, panelsIn, SIZE_LIMITS, SPLIT_LIMITS, usePanelLayout } from "./layout";
import { DockPanel, Resizer } from "./Panels";
import { useAi } from "./useAi";
import { useEditor } from "./useEditor";
import { usePlaybackKeys } from "./usePlaybackKeys";
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
 * are, and the transcript is where they're made. The preview stays put; the
 * transcript and the tools (in tabs: editing, the look, what to publish with
 * it, and export) are panels that dock left, right or below it, and split a
 * dock they share. Cuts can be hidden from both the strip and the
 * transcript, to read and see only what's kept.
 */
export function ProjectView({ projectId, jobs, onBack, onOpen, onRecord }: Props) {
  const [project, setProjectState] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState<Playhead | null>(null);
  const preview = useRef<PreviewHandle>(null);
  const [transport, setTransport] = useState<Transport>({ rate: 0 });

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
  const ai = useAi();
  const [hideCuts, toggleHideCuts] = useHideCuts();

  const seek = useCallback((sourceId: string, time: number) => {
    preview.current?.seek(sourceId, time);
    setPlayhead({ sourceId, time });
  }, []);

  const fps = project?.sources.find((s) => s.id === playhead?.sourceId)?.media.fps || 30;
  usePlaybackKeys(preview, fps);

  const hasWords = (project?.transcript.length ?? 0) > 0;
  const transcribed = project?.sources.some((s) => s.transcription) ?? false;

  const { layout, move, resize, split } = usePanelLayout();
  const editor = useRef<HTMLElement>(null);
  const middle = useRef<HTMLDivElement>(null);
  const docks = useRef<Partial<Record<Dock, HTMLDivElement | null>>>({});

  const panel = (id: PanelId, grow?: number) =>
    id === "transcript" ? (
      <DockPanel key={id} id={id} title="Transcript" dock={layout.dock[id]} onMove={(d) => move(id, d)} grow={grow}>
        {project && hasWords ? (
          <>
            <Spelling project={project} jobs={jobs} ai={ai} />
            <Transcript project={project} playhead={playhead} onSeek={seek} onEdit={edit} hideCuts={hideCuts} />
          </>
        ) : (
          <p className="empty__body">{transcribed ? "No speech found." : "The transcript appears here once it's ready."}</p>
        )}
      </DockPanel>
    ) : (
      <DockPanel key={id} id={id} title="Tools" dock={layout.dock[id]} onMove={(d) => move(id, d)} grow={grow}>
        {project && (
          <Tools
            pending={project.proposals.filter((p) => p.status === "pending").length}
            edit={
              <>
                {project.origin && <ShortsPanel project={project} jobs={jobs} ai={ai} onOpen={onOpen} />}
                <AiPanel project={project} jobs={jobs} ai={ai} />
                <Proposals project={project} onSeek={seek} onEdit={edit} />
                <PunchInsPanel project={project} onSeek={seek} onEdit={edit} />
                <MediaPanel project={project} onSeek={seek} onEdit={edit} />
                <SoundPanel project={project} onSeek={seek} onEdit={edit} />
              </>
            }
            look={
              <>
                <FramingPanel project={project} playhead={playhead} onEdit={edit} />
                <CaptionsPanel project={project} onEdit={edit} />
              </>
            }
            publish={
              <>
                <ThumbnailPanel project={project} playhead={playhead} jobs={jobs} onEdit={edit} />
                <WriteupPanel project={project} jobs={jobs} ai={ai} onSeek={seek} onEdit={edit} />
                {!project.origin && <ShortsPanel project={project} jobs={jobs} ai={ai} onOpen={onOpen} />}
              </>
            }
            export={<ExportPanel project={project} jobs={jobs} onEdit={edit} />}
          />
        )}
      </DockPanel>
    );

  // A dock and the hairline that sizes it; a dock with both panels splits, transcript first.
  const dockArea = (dock: Dock) => {
    const [first, second] = panelsIn(layout, dock);
    if (!first) return null;
    const side = dock !== "bottom";
    const sizer = (
      <Resizer
        key={`${dock}-size`}
        label={`Resize the ${dock} panel`}
        orientation={side ? "vertical" : "horizontal"}
        value={layout.size[dock]}
        {...SIZE_LIMITS}
        grow={dock === "left" ? "ArrowRight" : dock === "right" ? "ArrowLeft" : "ArrowUp"}
        measure={(x, y) => {
          const box = (dock === "bottom" ? middle : editor).current?.getBoundingClientRect();
          if (!box) return layout.size[dock];
          if (dock === "left") return ((x - box.left) / box.width) * 100;
          if (dock === "right") return ((box.right - x) / box.width) * 100;
          return ((box.bottom - y) / box.height) * 100;
        }}
        onChange={(v) => resize(dock, v)}
      />
    );
    const area = (
      <div
        key={dock}
        ref={(el) => {
          docks.current[dock] = el;
        }}
        className={`dock dock--${dock}`}
        style={{ flexBasis: `${layout.size[dock]}%` }}
      >
        {second ? (
          <>
            {panel(first, layout.split[dock])}
            <Resizer
              label={`Resize the ${dock} split`}
              orientation={side ? "horizontal" : "vertical"}
              value={layout.split[dock]}
              {...SPLIT_LIMITS}
              grow={side ? "ArrowDown" : "ArrowRight"}
              measure={(x, y) => {
                const box = docks.current[dock]?.getBoundingClientRect();
                if (!box) return layout.split[dock];
                return side ? ((y - box.top) / box.height) * 100 : ((x - box.left) / box.width) * 100;
              }}
              onChange={(v) => split(dock, v)}
            />
            {panel(second, 100 - layout.split[dock])}
          </>
        ) : (
          panel(first)
        )}
      </div>
    );
    return dock === "left" ? [area, sizer] : [sizer, area];
  };

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
            aria-label="Hide cuts"
            aria-pressed={hideCuts}
            title={hideCuts ? "Show cuts in the transcript and the strip" : "Hide cuts from the transcript and the strip"}
            onClick={toggleHideCuts}
          >
            {hideCuts ? <EyeOff className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden /> : <Eye className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />}
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
      <main ref={editor} className="project">
        {dockArea("left")}
        <div ref={middle} className="project__middle">
          {error && (
            <p className="notice notice--danger" role="alert">
              {error}
            </p>
          )}
          <section className="project__monitor" aria-label="Preview">
            <div className="project__screen">
              {project ? (
                <div className={project.aspectRatio === "9:16" ? "stage stage--tall" : "stage"}>
                  <Preview ref={preview} project={project} onTime={setPlayhead} onTransport={setTransport} />
                  <CaptionOverlay project={project} playhead={playhead} />
                </div>
              ) : (
                <div className="stage">
                  <div className="project__video project__video--pending" />
                </div>
              )}
            </div>
            {project && <TransportBar project={project} playhead={playhead} transport={transport} preview={preview} />}
            {project && <Waveform project={project} playhead={playhead} onSeek={seek} hideCuts={hideCuts} />}
            <JobLine jobs={jobs} onCancel={() => void bridge()?.invoke("jobs:cancel", { id: projectId })} />
          </section>
          {dockArea("bottom")}
        </div>
        {dockArea("right")}
      </main>
    </>
  );
}
