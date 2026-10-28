import type { AppInfoValue } from "@clipcat/ipc";
import { useEffect, useState } from "react";
import { bridge } from "./bridge";
import { Library } from "./library/Library";
import { ProjectView } from "./project/ProjectView";
import { Recorder } from "./record/Recorder";
import { Settings } from "./settings/Settings";
import { StatusBar } from "./StatusBar";
import { useJobs } from "./useJobs";
import { useUpdate } from "./useUpdate";

export function App() {
  const [info, setInfo] = useState<AppInfoValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
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
      ) : open ? (
        <ProjectView
          key={open}
          projectId={open}
          jobs={jobsFor(open)}
          onBack={() => setOpen(null)}
          onOpen={setOpen}
          onRecord={(name) => setRecording({ projectId: open, name })}
        />
      ) : settings ? (
        <Settings update={update} onBack={() => setSettings(false)} />
      ) : (
        <Library jobsFor={jobsFor} onOpen={setOpen} onSettings={() => setSettings(true)} onRecord={() => setRecording({ projectId: null, name: null })} />
      )}
      <StatusBar info={info} error={error} update={update} />
    </div>
  );
}
