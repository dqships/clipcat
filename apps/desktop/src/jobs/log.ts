// The latest state of recent jobs, for the MCP server's list_jobs: the UI
// follows jobs through pushed events, an outside agent asks.

import type { JobEvent } from "./queue";

/** Jobs remembered; older finished ones are forgotten first. */
const KEEP = 50;

export class JobLog {
  private jobs = new Map<string, JobEvent>();

  record(event: JobEvent): void {
    // Re-inserting keeps the map in order of last change.
    this.jobs.delete(event.jobId);
    this.jobs.set(event.jobId, event);
    for (const [id, job] of this.jobs) {
      if (this.jobs.size <= KEEP) break;
      if (job.state !== "queued" && job.state !== "running") this.jobs.delete(id);
    }
  }

  /** Newest change first; only `projectId`'s when given. */
  list(projectId: string | null): JobEvent[] {
    return [...this.jobs.values()].reverse().filter((j) => projectId === null || j.projectId === projectId);
  }
}
