import type { JobEventValue } from "@clipcat/ipc";
import { useEffect, useState } from "react";
import { bridge } from "./bridge";

/** What the UI shows for a project's work: the job in progress, how many wait, and the last failure. */
export type ProjectJobs = { active: JobEventValue | null; waiting: number; failed: JobEventValue | null };

const IDLE: ProjectJobs = { active: null, waiting: 0, failed: null };

/** Live job state per project, from the main process's job events. */
export function useJobs(): (projectId: string) => ProjectJobs {
  const [jobs, setJobs] = useState<Map<string, Map<string, JobEventValue>>>(new Map());

  useEffect(() => {
    const api = bridge();
    if (!api) return;
    return api.on("job", (event) => {
      setJobs((prev) => {
        const next = new Map(prev);
        const forProject = new Map(next.get(event.projectId));
        forProject.set(event.jobId, event);
        next.set(event.projectId, forProject);
        return next;
      });
    });
  }, []);

  return (projectId) => {
    const events = [...(jobs.get(projectId)?.values() ?? [])];
    if (events.length === 0) return IDLE;
    return {
      active: events.find((e) => e.state === "running") ?? null,
      waiting: events.filter((e) => e.state === "queued").length,
      failed: events.filter((e) => e.state === "failed").at(-1) ?? null,
    };
  };
}

/** Calls `refresh` whenever main reports a project changed. */
export function useProjectChanges(refresh: (id: string) => void): void {
  useEffect(() => {
    const api = bridge();
    if (!api) return;
    return api.on("project:changed", ({ id }) => refresh(id));
  }, [refresh]);
}
