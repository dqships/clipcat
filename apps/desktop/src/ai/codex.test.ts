import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentRun, SubmitReply } from "./analyze";
import { codexAgent, execArgs, isCodexAuthFailure, parseAnswer, probeCodex } from "./codex";
import { inheritedEnv } from "./env";
import { ANALYSIS_TASK, type AgentTask, CORRECTIONS_TASK, DESCRIBE_TASK, EDITOR_PROMPT, SHORTS_TASK } from "./prompt";

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
async function fakeCodex(answers: unknown[], { loggedIn = true } = {}) {
  const script = join(dir, "codex");
  const log = join(dir, "log.jsonl");
  await writeFile(
    script,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli 0.165.0"); process.exit(0); }
if (args[0] === "login") { if (${loggedIn}) { console.log("Logged in using ChatGPT"); process.exit(0); } console.error("Not logged in"); process.exit(1); }
const prompt = fs.readFileSync(0, "utf8");
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
  return { host, calls };
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
    for (const task of [ANALYSIS_TASK, CORRECTIONS_TASK, SHORTS_TASK, DESCRIBE_TASK] as AgentTask[]) strict(task.jsonSchema as Node);
  });

  it("attaches pictures right after the subcommand, where the list can't swallow the prompt", () => {
    expect(execArgs("/t").slice(0, 2)).toEqual(["exec", "--skip-git-repo-check"]);
    expect(execArgs("/t", ["/a/1.jpg", "/a/2.jpg"]).slice(0, 4)).toEqual(["exec", "--image", "/a/1.jpg,/a/2.jpg", "--skip-git-repo-check"]);
    expect(execArgs("/t").at(-1)).toBe("-");
  });

  it("reads the answer, dropping nulls and code fences", () => {
    expect(parseAnswer('```json\n{"proposals":[{"from":1,"keepFrom":null}],"suggestedTitle":"T"}\n```')).toEqual({
      proposals: [{ from: 1 }],
      suggestedTitle: "T",
    });
    expect(isCodexAuthFailure("Error: Not logged in. Run codex login")).toBe(true);
    expect(isCodexAuthFailure("stream disconnected")).toBe(false);
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
