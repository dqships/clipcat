import { describe, expect, it } from "vitest";
import { JobLog } from "./log";
import type { JobEvent } from "./queue";

const job = (n: number, state: JobEvent["state"], projectId = "p1"): JobEvent => ({ projectId, jobId: `job-${n}`, kind: "export", label: `Job ${n}`, state, fraction: null });

describe("JobLog", () => {
  it("keeps each job's latest state, most recently changed first", () => {
    const log = new JobLog();
    log.record(job(1, "queued"));
    log.record(job(2, "queued", "p2"));
    log.record(job(1, "running"));
    expect(log.list(null).map((j) => [j.jobId, j.state])).toEqual([
      ["job-1", "running"],
      ["job-2", "queued"],
    ]);
    expect(log.list("p2").map((j) => j.jobId)).toEqual(["job-2"]);
  });

  it("forgets old finished jobs, never running ones", () => {
    const log = new JobLog();
    log.record(job(0, "running"));
    for (let n = 1; n <= 60; n++) log.record(job(n, "done"));
    const ids = log.list(null).map((j) => j.jobId);
    expect(ids).toHaveLength(50);
    expect(ids).toContain("job-0");
    expect(ids).toContain("job-60");
    expect(ids).not.toContain("job-1");
  });
});
