import type { AppInfoValue } from "@clipcat/ipc";
import { useEffect, useState } from "react";
import { bridge } from "./bridge";
import { Library } from "./library/Library";
import { ProjectView } from "./project/ProjectView";
import { Settings } from "./settings/Settings";
import { StatusBar } from "./StatusBar";
import { useJobs } from "./useJobs";

export function App() {
  const [info, setInfo] = useState<AppInfoValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const jobsFor = useJobs();

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
      {open ? (
        <ProjectView key={open} projectId={open} jobs={jobsFor(open)} onBack={() => setOpen(null)} onOpen={setOpen} />
      ) : settings ? (
        <Settings onBack={() => setSettings(false)} />
      ) : (
        <Library jobsFor={jobsFor} onOpen={setOpen} onSettings={() => setSettings(true)} />
      )}
      <StatusBar info={info} error={error} />
    </div>
  );
}
