import type { AppInfoValue } from "@clipcat/ipc";
import { useEffect, useState } from "react";
import { bridge } from "./bridge";
import { Library } from "./library/Library";
import { ProjectView } from "./project/ProjectView";
import { Recorder } from "./record/Recorder";
import { type SectionId, Settings } from "./settings/Settings";
import { StatusBar } from "./StatusBar";
import { useJobs } from "./useJobs";
import { typing, useMenuCommand } from "./useMenu";
import { useUpdate } from "./useUpdate";

export function App() {
  const [info, setInfo] = useState<AppInfoValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // Settings, open on a page, over the library or the open project.
  const [settings, setSettings] = useState<{ section?: SectionId } | null>(null);
  // Recording a take, into the open project or a new one.
  const [recording, setRecording] = useState<{ projectId: string | null; name: string | null } | null>(null);
  const jobsFor = useJobs();
  const update = useUpdate();

  useEffect(() => {
    const api = bridge();
    if (!api) return;
    api
      .invoke("app:info")
      .then(setInfo)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    void api.invoke("app:ready", { screen: "library" });
  }, []);

  // Off the editor, the menu bar's project items are off.
  useEffect(() => {
    if (!open || recording) void bridge()?.invoke("menu:state", { project: null });
  }, [open, recording]);

  /** File > Import Videos: a new project from the picked files, opened. */
  const importVideos = async () => {
    const api = bridge();
    if (!api) return;
    try {
      const files = await api.invoke("files:pick");
      if (!files.length) return;
      const project = await api.invoke("project:import", { projectId: null, files });
      setSettings(null);
      setOpen(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useMenuCommand((command, projectId) => {
    // In a text box, Undo and Redo are the box's own; the editor handles them everywhere else.
    if (command === "undo" || command === "redo") {
      if (typing()) document.execCommand(command);
      return;
    }
    // A take being recorded keeps the window until it's saved or discarded.
    if (recording) return;
    if (command === "settings" || command === "settings-updates") {
      setOpen(null);
      setSettings(command === "settings" ? {} : { section: "updates" });
    } else if (command === "new-recording") {
      setRecording({ projectId: null, name: null });
    } else if (command === "import") {
      void importVideos();
    } else if (command === "open-project" && projectId) {
      setSettings(null);
      setOpen(projectId);
    }
  });

  return (
    <div className="app">
      {recording ? (
        <Recorder
          projectId={recording.projectId}
          projectName={recording.name}
          onBack={() => setRecording(null)}
          onDone={(id) => {
            setRecording(null);
            setOpen(id);
          }}
        />
      ) : settings ? (
        <Settings update={update} section={settings.section} onBack={() => setSettings(null)} />
      ) : open ? (
        <ProjectView
          key={open}
          projectId={open}
          jobs={jobsFor(open)}
          onBack={() => setOpen(null)}
          onOpen={setOpen}
          onRecord={(name) => setRecording({ projectId: open, name })}
          onSettings={(section) => setSettings({ section })}
        />
      ) : (
        <Library jobsFor={jobsFor} onOpen={setOpen} onSettings={() => setSettings({})} onRecord={() => setRecording({ projectId: null, name: null })} />
      )}
      <StatusBar info={info} error={error} update={update} />
    </div>
  );
}
