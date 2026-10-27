import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { source, words } from "@clipcat/core/fixtures";
import { JobQueue, type JobEvent } from "../jobs/queue";
import { ProjectStore } from "../store/projects";
import { type Agent, type AgentRun, AnalysisRunner } from "./analyze";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "clipcat-ai-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** An agent that sends each answer in turn and records what it was told. */
function scripted(answers: unknown[]) {
  const replies: string[] = [];
  const runs: AgentRun[] = [];
  const agent: Agent = {
    label: "Fake",
    run: async (run) => {
      runs.push(run);
      for (const answer of answers) {
        const reply = await run.submit(answer);
        replies.push(reply.text);
        if (reply.done) return;
      }
    },
  };
  return { agent, replies, runs };
}

async function setup(agent: Agent) {
  const store = new ProjectStore(root);
  const events: JobEvent[] = [];
  const queue = new JobQueue((e) => events.push(e));
  const created = await store.create("talk");
  // "so so I think I think we start" — a stutter and a restart.
  await store.update(created.id, null, (p) => {
    p.sources.push(source("a", 10));
    p.transcript = words("a", "so so I think I think we start");
  });
  const runner = new AnalysisRunner({ store, queue, agent: async () => agent, changed: () => {} });
  return { store, queue, events, runner, id: created.id };
}

const retake = { type: "retake", from: 2, to: 5, keepFrom: 4, keepTo: 5, reason: "Restarted", confidence: 0.9 };
const stutter = { type: "cleanup", from: 0, to: 0, reason: "Stutter", confidence: 0.8 };

describe("AnalysisRunner", () => {
  it("saves the brief and the agent's proposals, numbered against the transcript", async () => {
    const { agent, runs, replies } = scripted([{ proposals: [retake, stutter], suggestedTitle: "We start" }]);
    const { store, queue, runner, id } = await setup(agent);
    await runner.analyze(id, "Keep it short");
    await queue.idle(id);

    expect(runs[0]!.prompt).toContain("Keep it short");
    expect(runs[0]!.prompt).toContain("[0]so [1]so [2]I");
    expect(replies).toEqual(["Saved 2 proposals. Stop here."]);
    const p = await store.get(id);
    expect(p.brief).toBe("Keep it short");
    expect(p.suggestedTitle).toBe("We start");
    expect(p.proposals.map((x) => [x.type, x.wordIds])).toEqual([
      ["cleanup", ["a-w0"]],
      ["retake", ["a-w2", "a-w3"]],
    ]);
  });

  it("shows the agent its mistakes once, then keeps what checks out", async () => {
    const hallucinated = { type: "cleanup", from: 40, to: 41, reason: "Nope", confidence: 0.5 };
    const { agent, replies } = scripted([{ proposals: [hallucinated, stutter] }, { proposals: [hallucinated, stutter] }]);
    const { store, queue, runner, id } = await setup(agent);
    await runner.analyze(id, "");
    await queue.idle(id);

    expect(replies[0]).toMatch(/1 of 2 proposals have problems:\nproposal 0 \(cleanup 40..41\)/);
    expect(replies[1]).toBe("Saved 1 proposal. Stop here.");
    expect((await store.get(id)).proposals.map((x) => x.reason)).toEqual(["Stutter"]);
  });

  it("asks again when the answer doesn't match the schema", async () => {
    const { agent, replies } = scripted([{ proposals: [{ type: "cut", from: 0 }] }, { proposals: [stutter] }]);
    const { queue, runner, id } = await setup(agent);
    await runner.analyze(id, "");
    await queue.idle(id);
    expect(replies[0]).toMatch(/doesn't match the schema/);
    expect(replies[1]).toBe("Saved 1 proposal. Stop here.");
  });

  it("replaces pending AI proposals on a rerun but keeps the user's decisions", async () => {
    const { agent } = scripted([{ proposals: [retake, stutter] }]);
    const { store, queue, runner, id } = await setup(agent);
    await runner.analyze(id, "");
    await queue.idle(id);
    await store.update(id, null, (p) => {
      p.proposals[0]!.status = "rejected";
    });
    await runner.analyze(id, "");
    await queue.idle(id);

    const p = await store.get(id);
    expect(p.proposals.map((x) => [x.reason, x.status])).toEqual([
      ["Stutter", "rejected"],
      ["Restarted", "pending"],
    ]);
  });

  it("fails the job when the agent never answers", async () => {
    const { agent } = scripted([]);
    const { queue, events, runner, id } = await setup(agent);
    await runner.analyze(id, "");
    await queue.idle(id);
    expect(events.find((e) => e.state === "failed")?.error).toBe("Fake finished without proposing any cuts");
  });
});
