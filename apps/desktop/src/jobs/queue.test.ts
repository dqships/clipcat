import { describe, expect, it } from "vitest";
import { type JobEvent, JobQueue } from "./queue";

describe("JobQueue", () => {
  it("runs a project's jobs in order", async () => {
    const order: string[] = [];
    const q = new JobQueue(() => {});
    const slow = q.add("p", "a", "A", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("a");
    });
    const fast = q.add("p", "b", "B", async () => void order.push("b"));
    await Promise.all([slow, fast]);
    expect(order).toEqual(["a", "b"]);
  });

  it("keeps going after a failed job and reports it", async () => {
    const events: JobEvent[] = [];
    const q = new JobQueue((e) => events.push(e));
    await expect(q.add("p", "a", "A", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await q.add("p", "b", "B", async () => {});
    expect(events.filter((e) => e.state === "failed")[0]?.error).toBe("boom");
    expect(events.at(-1)).toMatchObject({ kind: "b", state: "done" });
  });

  it("cancels running and queued jobs", async () => {
    const events: JobEvent[] = [];
    const q = new JobQueue((e) => events.push(e));
    const running = q.add("p", "a", "A", ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")))));
    const queued = q.add("p", "b", "B", async () => {});
    await new Promise((r) => setTimeout(r, 0));
    q.cancel("p");
    await expect(running).rejects.toThrow();
    await queued;
    expect(events.filter((e) => e.state === "cancelled").map((e) => e.kind)).toEqual(["a", "b"]);
  });

  it("reports when a project's queue is idle", async () => {
    const q = new JobQueue(() => {});
    let done = false;
    void q.add("p", "a", "A", async () => Promise.reject(new Error("boom"))).catch(() => {});
    void q.add("p", "b", "B", async () => {
      await new Promise((r) => setTimeout(r, 10));
      done = true;
    });
    await q.idle("p");
    expect(done).toBe(true);
    await q.idle("other");
  });
});
