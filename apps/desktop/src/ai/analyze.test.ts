import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initialSegments, setRange } from "@clipcat/core";
import { asset, counter, source, words } from "@clipcat/core/fixtures";
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
  const runner = new AnalysisRunner({ store, queue, agent: async () => agent, dictionary: async () => ["Kubernetes"], changed: () => {} });
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

  it("saves punch-ins as zooms, spaced out, and tells the agent which were too close", async () => {
    const early = { type: "punch-in", from: 0, to: 2, punchStyle: "cut", reason: "Opener", confidence: 0.5 };
    const late = { type: "punch-in", from: 4, to: 7, punchStyle: "slow-zoom", reason: "The point", confidence: 0.9 };
    const { agent, replies } = scripted([{ proposals: [early, late] }, { proposals: [early, late] }]);
    const { store, queue, runner, id } = await setup(agent);
    await store.update(id, null, (p) => {
      p.segments = initialSegments("a", 10, counter("g"));
    });
    await runner.analyze(id, "");
    await queue.idle(id);

    expect(replies[0]).toContain("punch-in at word 0: too close to another punch-in");
    const p = await store.get(id);
    expect(p.proposals.map((x) => [x.type, x.cuts, x.punch?.style])).toEqual([["punch-in", [], "slow-zoom"]]);
    // A punch-in cuts nothing when accepted.
    expect(p.proposals[0]!.wordIds).toEqual(["a-w4", "a-w5", "a-w6", "a-w7"]);
  });

  it("fails the job when the agent never answers", async () => {
    const { agent } = scripted([]);
    const { queue, events, runner, id } = await setup(agent);
    await runner.analyze(id, "");
    await queue.idle(id);
    expect(events.find((e) => e.state === "failed")?.error).toBe("Fake finished without an answer");
  });

  it("adds cuts for a request to the ones waiting, replacing only what they overlap", async () => {
    // One answer per run.
    const answers: unknown[] = [{ proposals: [stutter, retake] }, { proposals: [{ ...stutter, reason: "Asked for" }] }];
    const runs: AgentRun[] = [];
    const agent: Agent = {
      label: "Fake",
      run: async (run) => {
        runs.push(run);
        await run.submit(answers.shift());
      },
    };
    const { store, queue, runner, id } = await setup(agent);
    await runner.analyze(id, "");
    await queue.idle(id);
    runner.request(id, "cut the first so");
    await queue.idle(id);

    expect(runs[1]!.prompt).toMatch(/^The user asks for one change:\ncut the first so\n/);
    const p = await store.get(id);
    expect(p.proposals.map((x) => x.reason).sort()).toEqual(["Asked for", "Restarted"]);
  });

  it("corrects misheard words with the dictionary, keeping what was heard", async () => {
    const { agent, runs, replies } = scripted([{ corrections: [{ index: 7, text: "started." }, { index: 3, text: "think" }] }]);
    const { store, queue, runner, id } = await setup(agent);
    runner.correct(id);
    await queue.idle(id);

    expect(runs[0]!.task.tool).toBe("submit_corrections");
    expect(runs[0]!.prompt).toContain("Kubernetes");
    expect(replies).toEqual(["Saved 1 correction. Stop here."]);
    const w = (await store.get(id)).transcript[7]!;
    expect(w).toMatchObject({ text: "started.", heard: "start" });
  });
});

describe("AnalysisRunner shorts", () => {
  // 20 words, 12 s, in one recording with its prepared media on disk.
  async function long(agent: Agent) {
    const store = new ProjectStore(root);
    const queue = new JobQueue(() => {});
    const created = await store.create("Long talk");
    const media = store.mediaDir(created.id, "a");
    await mkdir(join(media, "thumbs"), { recursive: true });
    await writeFile(join(media, "proxy.mp4"), "video");
    await writeFile(join(media, "thumbs", "0001.jpg"), "jpg");
    await store.update(created.id, null, (p) => {
      p.sources.push({ ...source("a", 12.5), prep: { proxy: "media/a/proxy.mp4", wav: "media/a/audio.wav", waveform: "media/a/waveform.png", thumbs: "media/a/thumbs/%04d.jpg" } });
      p.transcript = words("a", Array.from({ length: 20 }, (_, i) => `w${i}`).join(" "));
      // The long edit already cut 3 s to 4 s.
      p.segments = setRange(initialSegments("a", 12.5, counter("s")), "a", [3, 4], false, counter("t"));
    });
    const runner = new AnalysisRunner({ store, queue, agent: async () => agent, dictionary: async () => [], changed: () => {} });
    return { store, queue, runner, id: created.id };
  }

  it("makes each short its own vertical project sharing the long video's media", async () => {
    const { agent, runs, replies } = scripted([
      {
        shorts: [
          { title: "The hook", reason: "Bold claim up front", ranges: [{ from: 0, to: 12 }] },
          { title: "Nope", reason: "x", ranges: [{ from: 50, to: 60 }] },
        ],
      },
      { shorts: [{ title: "The hook", reason: "Bold claim up front", ranges: [{ from: 0, to: 12 }] }] },
    ]);
    const { store, queue, runner, id } = await long(agent);
    runner.shorts(id, 2, 30);
    await queue.idle(id);

    expect(runs[0]!.prompt).toContain("Pick up to 2 shorts, each 15 to 30 seconds long");
    // Words the long edit cut are marked.
    expect(runs[0]!.prompt).toContain("[5]~w5~");
    expect(replies[0]).toMatch(/1 of 2 shorts have problems/);
    expect(replies[1]).toBe("Saved 1 short. Stop here.");

    const parent = await store.get(id);
    expect(parent.shorts).toHaveLength(1);
    const short = await store.get(parent.shorts[0]!.id);
    expect(short).toMatchObject({ name: "The hook", aspectRatio: "9:16", origin: { projectId: id, name: "Long talk" } });
    expect(short.segments.filter((s) => s.included).map((s) => [s.sourceStart, s.sourceEnd])).toEqual([
      [0, 3],
      [4, expect.closeTo(7.75)],
    ]);
    const proxy = join(store.mediaDir(short.id, "a"), "proxy.mp4");
    expect(await readFile(proxy, "utf8")).toBe("video");
    expect(await readFile(join(store.mediaDir(short.id, "a"), "thumbs", "0001.jpg"), "utf8")).toBe("jpg");
    // A hard link where the disk allows it: the same file, not a copy.
    if (process.platform !== "win32") expect((await stat(proxy)).ino).toBe((await stat(join(store.mediaDir(id, "a"), "proxy.mp4"))).ino);
    expect((await store.list()).find((x) => x.id === short.id)?.origin).toBe("Long talk");
  });
});

describe("AnalysisRunner media", () => {
  it("shows the agent each item's frames and saves what it says, keeping what the user wrote", async () => {
    const { agent, runs, replies } = scripted([
      { descriptions: [{ media: 0, description: "A drone over a city" }] },
      { descriptions: [{ media: 0, description: "A drone over a city" }, { media: 1, description: "A bar chart" }] },
    ]);
    const { store, queue, runner, id } = await setup(agent);
    await store.update(id, null, (p) => {
      p.assets = [asset("m1", "video"), { ...asset("m2", "image") }, { ...asset("m3", "image"), description: "Mine" }, { ...asset("m4"), prep: null }];
    });
    runner.describe(id);
    await queue.idle(id);

    expect(runs[0]!.images).toEqual([join(store.dir(id), "media/assets/m1/frame-1.jpg"), join(store.dir(id), "media/assets/m2/frame-1.jpg")]);
    expect(runs[0]!.prompt).toContain("[1] m2.png: picture, 1 frame");
    expect(replies[0]).toContain("media 1: not described");
    const p = await store.get(id);
    expect(p.assets.map((a) => a.description)).toEqual(["A drone over a city", "A bar chart", "Mine", ""]);
  });

  it("offers prepared media to the editor and turns its b-roll into proposals", async () => {
    const broll = { type: "visual", from: 4, to: 7, media: 0, placement: "pip", reason: "Shows it", confidence: 0.6 };
    const { agent, runs } = scripted([{ proposals: [broll] }]);
    const { store, queue, runner, id } = await setup(agent);
    await store.update(id, null, (p) => {
      p.assets = [{ ...asset("m1"), description: "A drone over a city" }];
    });
    await runner.analyze(id, "");
    await queue.idle(id);

    expect(runs[0]!.prompt).toContain("## Media for b-roll\n[0] m1.mp4 (video, 10.0s): A drone over a city");
    expect((await store.get(id)).proposals[0]).toMatchObject({ type: "visual", status: "pending", overlay: { assetId: "m1", placement: "pip" } });
  });
});
