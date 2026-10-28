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
    expect(events.find((e) => e.state === "failed")?.error).toBe("Fake finished without suggesting anything. Try again.");
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

describe("AnalysisRunner slides", () => {
  const slide = { type: "slide", from: 2, to: 7, brief: "Three steps", look: "paper", reason: "Lists them", confidence: 0.7 };

  /** An editor that proposes `proposals`, and a designer that sends `designs` in turn. */
  async function studio(proposals: unknown[], designs: string[], render?: (times: number[]) => { duration: number; errors: string[] }) {
    const replies: { text: string; done: boolean; images?: string[] }[] = [];
    const runs: AgentRun[] = [];
    const forgotten: string[] = [];
    const agent: Agent = {
      label: "Fake",
      run: async (run) => {
        runs.push(run);
        if (run.task.tool !== "submit_slide") {
          await run.submit({ proposals });
          return;
        }
        for (const html of designs) {
          const reply = await run.submit({ html });
          replies.push(reply);
          if (reply.done) return;
        }
      },
    };
    const base = await setup(agent);
    const rendered: { html: string; times: number[] }[] = [];
    const runner = new AnalysisRunner({
      store: base.store,
      queue: base.queue,
      agent: async () => agent,
      dictionary: async () => [],
      changed: () => {},
      forget: (_, assetId) => forgotten.push(assetId),
      slides: {
        stills: async (draft, _frame, times, files) => {
          rendered.push({ html: draft.html, times });
          const result = render?.(times) ?? { duration: 1, errors: [] };
          for (const f of files) await writeFile(f, "jpeg");
          return result;
        },
      },
    });
    return { ...base, runner, replies, runs, rendered, forgotten };
  }

  it("adds the slides the editor proposes and designs each, showing the designer its stills before saving", async () => {
    const { store, queue, runner, id, replies, runs, rendered } = await studio([slide], ["<h1>One</h1>", "<h1>Two</h1>"]);
    await runner.analyze(id, "");
    await queue.idle(id); // the analysis, which queues the designs
    await queue.idle(id);

    const p = await store.get(id);
    const made = p.assets[0]!;
    expect(p.proposals[0]).toMatchObject({ type: "visual", status: "pending", overlay: { assetId: made.id, placement: "full" } });
    expect(runs[1]!.prompt).toContain("Brief:\nThree steps\nLook: paper\nFrame: 1920×1080 (wide)");
    expect(runs[1]!.prompt).toContain('says over it: "I think I think we start"');
    expect(replies[0]).toMatchObject({ done: false, images: [1, 2, 3].map((n) => join(store.dir(id), `media/assets/${made.id}/still-${n}.jpg`)) });
    expect(replies[0]!.text).toContain("Here is your slide at 0.4s, 1.8s");
    expect(replies[1]).toMatchObject({ done: true, text: "Saved the slide. Stop here." });
    expect(rendered.map((r) => r.html)).toEqual(["<h1>One</h1>", "<h1>Two</h1>"]);
    expect(made).toMatchObject({
      kind: "slide",
      media: { width: 1920, height: 1080 },
      slide: { brief: "Three steps", html: "<h1>Two</h1>" },
      prep: { preview: `media/assets/${made.id}/still-2.jpg` },
    });
  });

  it("sends back what the page reported, and saves nothing that never renders", async () => {
    const { store, queue, runner, id, replies, events } = await studio([slide], ["<h1>One</h1>", "<h1>Two</h1>", "<h1>Three</h1>"], () => {
      throw new Error("boom");
    });
    await runner.analyze(id, "");
    await queue.idle(id); // the analysis, which queues the designs
    await queue.idle(id);

    expect(replies[0]!.text).toContain("The slide didn't render: boom");
    expect(replies.at(-1)).toMatchObject({ done: true, text: "Nothing was saved. Stop here." });
    expect(events.find((e) => e.kind === "design" && e.state === "failed")?.error).toContain("didn't render");
    expect((await store.get(id)).assets[0]!.slide!.html).toBe("");
  });

  it("asks for a fix when the page errors or runs too long", async () => {
    const { queue, runner, id, replies } = await studio([slide], ["<h1>One</h1>", "<h1>Two</h1>"], () => ({ duration: 9, errors: ["x is not defined"] }));
    await runner.analyze(id, "");
    await queue.idle(id); // the analysis, which queues the designs
    await queue.idle(id);

    expect(replies[0]!.text).toContain("The page reported an error: x is not defined");
    expect(replies[0]!.text).toContain("The animations run for 9.0s, but the slide only shows for 3.5s");
    expect(replies[0]!.images).toHaveLength(3);
  });

  it("designs a slide again when its brief changes while it is being designed", async () => {
    let rebrief: (() => Promise<void>) | null = null;
    let pending: Promise<void> | null = null;
    const { store, queue, runner, id, rendered } = await studio([slide], ["<h1>One</h1>", "<h1>Two</h1>"], () => {
      if (rebrief) {
        pending = rebrief();
        rebrief = null;
      }
      return { duration: 1, errors: [] };
    });
    rebrief = async () => {
      await store.update(id, null, (p) => {
        p.assets[0]!.slide!.brief = "Four steps";
      });
      await runner.designMissing(id); // what an edit to the brief does
    };
    await runner.analyze(id, "");
    for (let i = 0; i < 4; i++) {
      await queue.idle(id);
      await pending;
      await new Promise((r) => setTimeout(r, 10));
    }

    const made = (await store.get(id)).assets[0]!;
    expect(made.slide).toMatchObject({ brief: "Four steps", html: "<h1>Two</h1>" });
    expect(rendered).toHaveLength(4);
  });

  it("drops a slide whose proposal a rerun replaced", async () => {
    const { store, queue, runner, id, forgotten } = await studio([slide], ["<h1>One</h1>", "<h1>One</h1>"]);
    await runner.analyze(id, "");
    await queue.idle(id); // the analysis, which queues the designs
    await queue.idle(id);
    const first = (await store.get(id)).assets[0]!.id;
    await runner.analyze(id, "");
    await queue.idle(id); // the analysis, which queues the designs
    await queue.idle(id);

    const p = await store.get(id);
    expect(p.assets).toHaveLength(1);
    expect(p.assets[0]!.id).not.toBe(first);
    expect(forgotten).toEqual([first]);
  });
});

describe("AnalysisRunner write-up", () => {
  it("asks again for enough chapters, then saves the chapters, description and article", async () => {
    const article = { title: "Two hundred words", markdown: "They add up." };
    const { agent, runs, replies } = scripted([
      { chapters: [{ word: 0, title: "Start" }, { word: 100, title: "Middle" }], description: "About words.", article },
      { chapters: [{ word: 0, title: "Start" }, { word: 60, title: "Middle" }, { word: 150, title: "End" }], description: "About words.", article },
    ]);
    const store = new ProjectStore(root);
    const queue = new JobQueue(() => {});
    const created = await store.create("talk");
    await store.update(created.id, null, (p) => {
      p.sources.push(source("a", 120));
      p.transcript = words("a", Array.from({ length: 200 }, (_, i) => `w${i}`).join(" "));
      p.segments = setRange(initialSegments("a", 120, counter("s")), "a", [6, 12], false, counter("t"));
    });
    const runner = new AnalysisRunner({ store, queue, agent: async () => agent, dictionary: async () => [], changed: () => {} });
    runner.writeup(created.id);
    await queue.idle(created.id);

    expect(runs[0]!.system).toContain("You are ClipCat's writer");
    expect(runs[0]!.prompt).toContain("The finished video is 114 seconds long.");
    expect(runs[0]!.prompt).toContain("~w10~");
    expect(replies[0]).toContain("give at least 3 chapters");
    expect(replies[1]).toBe("Saved 3 chapters, the description and the article. Stop here.");
    expect((await store.get(created.id)).writeup).toEqual({
      chapters: [
        { wordId: "a-w0", title: "Start" },
        { wordId: "a-w60", title: "Middle" },
        { wordId: "a-w150", title: "End" },
      ],
      description: "About words.",
      article,
    });
  });
});
