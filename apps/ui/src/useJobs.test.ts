import type { JobEventValue } from "@clipcat/ipc";
import { describe, expect, it } from "vitest";
import { standing } from "./useJobs";

const job = (jobId: string, kind: string, state: JobEventValue["state"]): JobEventValue => ({ projectId: "p", jobId, kind, label: jobId, state, fraction: null });

describe("standing", () => {
  it("keeps one slide's failed design while another slide's design waits", () => {
    const left = standing([job("a", "design", "failed"), job("b", "design", "queued")]);
    expect(left.filter((e) => e.state === "failed").map((e) => e.jobId)).toEqual(["a"]);
  });

  it("lets a newer run of a project-wide job replace an older failure", () => {
    const left = standing([job("a", "analyze", "failed"), job("b", "analyze", "done")]);
    expect(left.map((e) => e.jobId)).toEqual(["b"]);
  });
});
