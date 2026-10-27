// One queue per project: jobs for the same project run in order (prep before
// transcription before analysis), different projects run side by side. Each
// job reports progress and can be cancelled.

export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";

export type JobEvent = {
  projectId: string;
  jobId: string;
  kind: string;
  label: string;
  state: JobState;
  fraction: number | null;
  error?: string;
};

export type JobContext = { signal: AbortSignal; progress: (fraction: number | null, label?: string) => void };
export type JobFn = (ctx: JobContext) => Promise<void>;

let nextId = 0;

export class JobQueue {
  private tails = new Map<string, Promise<void>>();
  private controllers = new Map<string, Set<AbortController>>();

  constructor(private readonly emit: (event: JobEvent) => void) {}

  add(projectId: string, kind: string, label: string, fn: JobFn): Promise<void> {
    const jobId = `job-${++nextId}`;
    const controller = new AbortController();
    const set = this.controllers.get(projectId) ?? new Set();
    set.add(controller);
    this.controllers.set(projectId, set);

    let current = label;
    const send = (state: JobState, fraction: number | null, error?: string) =>
      this.emit({ projectId, jobId, kind, label: current, state, fraction, ...(error ? { error } : {}) });
    send("queued", null);

    const run = async () => {
      if (controller.signal.aborted) {
        set.delete(controller);
        send("cancelled", null);
        return;
      }
      send("running", 0);
      let last = 0;
      try {
        await fn({
          signal: controller.signal,
          progress: (fraction, newLabel) => {
            if (newLabel) current = newLabel;
            // At most ~50 events per job: the UI only needs to see it move.
            if (fraction === null || fraction - last >= 0.02 || fraction === 1 || newLabel) {
              last = fraction ?? last;
              send("running", fraction);
            }
          },
        });
        send(controller.signal.aborted ? "cancelled" : "done", 1);
      } catch (e) {
        if (controller.signal.aborted) send("cancelled", null);
        else send("failed", null, e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        set.delete(controller);
      }
    };

    const tail = this.tails.get(projectId) ?? Promise.resolve();
    const job = tail.then(run, run);
    this.tails.set(projectId, job.catch(() => {}));
    return job;
  }

  /** Resolves once every job queued so far for the project has finished, however it ended. */
  idle(projectId: string): Promise<void> {
    return this.tails.get(projectId) ?? Promise.resolve();
  }

  /** Cancels every queued and running job of a project. */
  cancel(projectId: string): void {
    for (const c of this.controllers.get(projectId) ?? []) c.abort();
  }
}
