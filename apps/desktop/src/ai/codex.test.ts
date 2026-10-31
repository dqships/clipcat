import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentRun, SubmitReply } from "./analyze";
import { cachedModels, codexAgent, configModel, execArgs, isCodexAuthFailure, parseAnswer, probeCodex, refusedModel, resolveCodex } from "./codex";
import { inheritedEnv } from "./env";
import { ANALYSIS_TASK, type AgentTask, CORRECTIONS_TASK, DESCRIBE_TASK, EDITOR_PROMPT, SHORTS_TASK, SLIDE_TASK } from "./prompt";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clipcat-codex-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * A stand-in `codex`: `--version`, `login status`, and an `exec` that writes
 * the next canned answer to the --output-last-message file and logs its argv
 * and prompt.
 */
async function fakeCodex(answers: unknown[], { loggedIn = true, version = "0.165.0", refuse = "", folder = dir } = {}) {
  await mkdir(folder, { recursive: true });
  const script = join(folder, "codex");
  const log = join(dir, "log.jsonl");
  await writeFile(
    script,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli ${version}"); process.exit(0); }
if (args[0] === "login") { if (${loggedIn}) { console.log("Logged in using ChatGPT"); process.exit(0); } console.error("Not logged in"); process.exit(1); }
const prompt = fs.readFileSync(0, "utf8");
if (${JSON.stringify(refuse)}) { console.error(${JSON.stringify(JSON.stringify(`ERROR: {"error":{"message":"The '${refuse}' model is not supported when using Codex with a ChatGPT account.","code":"model_not_found"}}`))}); process.exit(1); }
const lines = fs.existsSync(${JSON.stringify(log)}) ? fs.readFileSync(${JSON.stringify(log)}, "utf8").split("\\n").filter(Boolean) : [];
const answers = ${JSON.stringify(answers)};
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, prompt }) + "\\n");
const out = args[args.indexOf("--output-last-message") + 1];
fs.writeFileSync(out, JSON.stringify(answers[lines.length]));
`,
  );
  await chmod(script, 0o755);
  const host = inheritedEnv();
  host.env = { ...host.env, CLIPCAT_CODEX_PATH: script };
  const calls = async () =>
    (await readFile(log, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { args: string[]; prompt: string });
  return { host, calls, script };
}

function run(replies: SubmitReply[]) {
  const seen: unknown[] = [];
  const r: AgentRun = {
    task: ANALYSIS_TASK,
    system: EDITOR_PROMPT,
    prompt: "TRANSCRIPT",
    submit: async (input) => {
      seen.push(input);
      return replies[seen.length - 1]!;
    },
    activity: () => {},
    signal: new AbortController().signal,
  };
  return { r, seen };
}

describe("codex", () => {
  it("asks for strict schemas: every property required, nothing extra", () => {
    type Node = { type?: unknown; properties?: Record<string, Node>; required?: string[]; additionalProperties?: boolean; items?: Node };
    const strict = (node: Node): void => {
      if (node.properties) {
        expect([...(node.required ?? [])].sort()).toEqual(Object.keys(node.properties).sort());
        expect(node.additionalProperties).toBe(false);
        Object.values(node.properties).forEach(strict);
      }
      if (node.items) strict(node.items);
    };
    for (const task of [ANALYSIS_TASK, CORRECTIONS_TASK, SHORTS_TASK, DESCRIBE_TASK, SLIDE_TASK] as AgentTask[]) strict(task.jsonSchema as Node);
  });

  it("attaches pictures right after the subcommand, where the list can't swallow the prompt", () => {
    expect(execArgs("/t").slice(0, 2)).toEqual(["exec", "--skip-git-repo-check"]);
    expect(execArgs("/t", ["/a/1.jpg", "/a/2.jpg"]).slice(0, 4)).toEqual(["exec", "--image", "/a/1.jpg,/a/2.jpg", "--skip-git-repo-check"]);
    expect(execArgs("/t").at(-1)).toBe("-");
  });

  it("passes a picked model, and none when Codex's default should run", () => {
    expect(execArgs("/t", [], "gpt-6-luna")).toEqual(expect.arrayContaining(["--model", "gpt-6-luna"]));
    expect(execArgs("/t")).not.toContain("--model");
  });

  it("reads config.toml's model and the models Codex lists", () => {
    expect(configModel('model = "gpt-6.1-sol"\nmodel_reasoning_effort = "high"\n\n[projects."/x"]\nmodel = "other"\n')).toBe("gpt-6.1-sol");
    expect(configModel('[profiles.fast]\nmodel = "gpt-6-luna"\n')).toBeNull();
    const cache = JSON.stringify({
      models: [
        { slug: "gpt-6-luna", display_name: "GPT-6-Luna", visibility: "list", priority: 5 },
        { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide", priority: 4 },
        { slug: "gpt-6.1-sol", display_name: "GPT-6.1-Sol", visibility: "list", priority: 1 },
      ],
    });
    expect(cachedModels(cache)).toEqual([
      { id: "gpt-6.1-sol", label: "GPT-6.1-Sol" },
      { id: "gpt-6-luna", label: "GPT-6-Luna" },
    ]);
    expect(cachedModels("{nope")).toEqual([]);
  });

  it("reads the answer, dropping nulls and code fences", () => {
    expect(parseAnswer('```json\n{"proposals":[{"from":1,"keepFrom":null}],"suggestedTitle":"T"}\n```')).toEqual({
      proposals: [{ from: 1 }],
      suggestedTitle: "T",
    });
    expect(isCodexAuthFailure("Error: Not logged in. Run codex login")).toBe(true);
    expect(isCodexAuthFailure("stream disconnected")).toBe(false);
  });

  it("names the model Codex refused, and nothing for other failures", () => {
    const stderr =
      "warning: Model metadata for `gpt-6.1-sol` not found. Defaulting to fallback metadata\n" +
      'ERROR: {"type":"error","status":400,"error":{"message":"The \'gpt-6.1-sol\' model is not supported when using Codex with a ChatGPT account.","code":"model_not_found"}}';
    expect(refusedModel(stderr)).toBe("gpt-6.1-sol");
    expect(refusedModel("warning: Model metadata for `gpt-x` not found. Defaulting to fallback metadata")).toBeNull();
    expect(refusedModel("stream disconnected")).toBeNull();
  });

  it.skipIf(process.platform === "win32")("runs the newest codex found, not just the first on PATH", async () => {
    const old = await fakeCodex([], { version: "0.157.1", folder: join(dir, "old") });
    const fresh = await fakeCodex([], { version: "0.999.0", folder: join(dir, "new") });
    const { CLIPCAT_CODEX_PATH: _, ...env } = old.host.env;
    const saved = process.env.CLIPCAT_CODEX_PATH;
    delete process.env.CLIPCAT_CODEX_PATH;
    try {
      const host = { env: { ...env, PATH: [join(dir, "old"), join(dir, "new"), env.PATH].join(":") }, extraDirs: [] };
      expect(await resolveCodex(host)).toEqual({ binary: fresh.script, version: "0.999.0" });
      expect((await probeCodex(host)).version).toBe("0.999.0");
    } finally {
      if (saved !== undefined) process.env.CLIPCAT_CODEX_PATH = saved;
    }
  });

  it.skipIf(process.platform === "win32")("says which model Codex refused, and what to do", async () => {
    const { host } = await fakeCodex([], { version: "0.157.1", refuse: "gpt-6.1-sol" });
    const { r } = run([]);
    await expect(codexAgent(host).run(r)).rejects.toThrow(
      'Codex 0.157.1 can\'t use the model "gpt-6.1-sol" set in ~/.codex/config.toml. Pick another model in Settings > AI models, or update Codex.',
    );
  });

  it.skipIf(process.platform === "win32")("runs the picked model, and names it when Codex refuses it", async () => {
    const { host, calls } = await fakeCodex([{ proposals: [], suggestedTitle: "T" }]);
    await codexAgent(host, "gpt-6-luna").run(run([{ text: "Saved 0 proposals.", done: true }]).r);
    expect((await calls())[0]!.args).toEqual(expect.arrayContaining(["--model", "gpt-6-luna"]));
    const refused = await fakeCodex([], { version: "0.157.1", refuse: "gpt-6-luna", folder: join(dir, "refuse") });
    await expect(codexAgent(refused.host, "gpt-6-luna").run(run([]).r)).rejects.toThrow(
      'Codex 0.157.1 can\'t use the model "gpt-6-luna". Pick another model in Settings > AI models, or update Codex.',
    );
  });

  it.skipIf(process.platform === "win32")("probes the CLI and its login", async () => {
    const { host } = await fakeCodex([]);
    expect(await probeCodex(host)).toEqual({ status: "ready", version: "0.165.0", detail: null });
    const out = await fakeCodex([], { loggedIn: false });
    expect((await probeCodex(out.host)).status).toBe("signed-out");
  });

  it.skipIf(process.platform === "win32")("runs exec read-only with the schema, and retries once with the problems", async () => {
    const bad = { proposals: [{ type: "cleanup", from: 0, to: 99, keepFrom: null, keepTo: null, reason: "x", confidence: 1 }], suggestedTitle: "" };
    const good = { proposals: [], suggestedTitle: "Title" };
    const { host, calls } = await fakeCodex([bad, good]);
    const { r, seen } = run([
      { text: "proposal 0: word indices out of range", done: false },
      { text: "Saved 0 proposals.", done: true },
    ]);
    await codexAgent(host).run(r);

    expect(seen).toEqual([{ ...bad, proposals: [{ type: "cleanup", from: 0, to: 99, reason: "x", confidence: 1 }] }, good]);
    const [first, second] = await calls();
    expect(first!.args).toEqual(expect.arrayContaining(["exec", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", "--output-schema", "-"]));
    expect(first!.prompt).toContain("Answer with only the JSON object");
    expect(first!.prompt).not.toContain("Call submit_analysis");
    expect(first!.prompt).toContain("TRANSCRIPT");
    expect(second!.prompt).toContain("word indices out of range");
  });
});

describe("codexAgent pictures", () => {
  it.skipIf(process.platform === "win32")("attaches a reply's pictures to the next run", async () => {
    const { host, calls } = await fakeCodex([{ html: "<h1>1</h1>" }, { html: "<h1>2</h1>" }]);
    const { r } = run([
      { text: "Here is your slide.", done: false, images: ["/s/still-1.jpg", "/s/still-2.jpg"] },
      { text: "Saved the slide.", done: true },
    ]);
    await codexAgent(host).run(r);

    const [first, second] = await calls();
    expect(first!.args).not.toContain("--image");
    expect(second!.args.slice(0, 3)).toEqual(["exec", "--image", "/s/still-1.jpg,/s/still-2.jpg"]);
    expect(second!.prompt).toContain("the attached images are how it looks");
  });
});
