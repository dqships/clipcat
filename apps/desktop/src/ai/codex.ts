// Codex through `codex exec`, using the user's own signed-in Codex CLI. Each
// attempt is one non-interactive run in a read-only sandbox, in an empty
// temporary folder, held to a JSON output schema; ClipCat checks the answer
// the same way it checks Claude's, and a first answer with problems goes back
// once with the list. No MCP server, port or config change is involved.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentRun } from "./analyze";
import type { AgentStatus } from "./claude";
import { type HostEnv, compareVersions, killTree, needsShell, parseVersion, quoteArg, resolveBinary, runOnce } from "./env";
import { JSON_ANSWER, TOOL_ANSWER } from "./prompt";

/** The first release with `exec --output-schema` and `--ephemeral`. */
const MIN_VERSION = "0.100.0";
const ATTEMPTS = 2;

export const CODEX_SIGN_IN_HINT = "Run `codex login` in a terminal, then try again.";

/**
 * The answer's JSON Schema, in the strict form OpenAI structured output wants:
 * every property required and no extras, so the optional keep range is null.
 */
export const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["proposals", "suggestedTitle"],
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "from", "to", "keepFrom", "keepTo", "reason", "confidence"],
        properties: {
          type: { type: "string", enum: ["retake", "cleanup", "tighten"] },
          from: { type: "integer" },
          to: { type: "integer" },
          keepFrom: { type: ["integer", "null"] },
          keepTo: { type: ["integer", "null"] },
          reason: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
    suggestedTitle: { type: "string" },
  },
} as const;

export function isCodexAuthFailure(text: string): boolean {
  return /not logged in|log ?in required|please log ?in|unauthori[sz]ed|401|authentication|expired.*token|token.*expired/i.test(text);
}

/** The model's last message as JSON, with nulls dropped so the shared schema reads it. */
export function parseAnswer(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(body, (_key, value: unknown) => (value === null ? undefined : value));
}

export async function probeCodex(host: HostEnv): Promise<AgentStatus> {
  const binary = resolveBinary("codex", host);
  if (!binary) return { status: "not-installed", version: null, detail: "Install the Codex CLI, then reopen ClipCat." };
  const version = parseVersion(await runOnce(binary, ["--version"], host)) ?? null;
  if (version && compareVersions(version, MIN_VERSION) < 0) {
    return { status: "outdated", version, detail: `Update Codex: ${version} is older than ${MIN_VERSION}.` };
  }
  // `codex login status` fails when there is no login; what it prints when there is one varies.
  const login = await runOnce(binary, ["login", "status"], host, 8000);
  if (login === null || /not logged in|logged out/i.test(login)) return { status: "signed-out", version, detail: CODEX_SIGN_IN_HINT };
  return { status: "ready", version, detail: null };
}

/** One `codex exec`: the prompt on stdin, the final message written to `out`. */
function exec(binary: string, dir: string, prompt: string, host: HostEnv, signal: AbortSignal): Promise<void> {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "--output-schema",
    join(dir, "schema.json"),
    "--output-last-message",
    join(dir, "answer.json"),
    "-",
  ];
  const shell = needsShell(binary);
  return new Promise((resolve, reject) => {
    const child = spawn(shell ? `"${binary}"` : binary, shell ? args.map(quoteArg) : args, {
      cwd: dir,
      env: host.env,
      stdio: ["pipe", "ignore", "pipe"],
      shell,
      windowsHide: true,
    });
    let stderr = "";
    const stop = () => void killTree(child);
    signal.addEventListener("abort", stop, { once: true });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", (e) => {
      signal.removeEventListener("abort", stop);
      reject(e);
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", stop);
      if (signal.aborted) return reject(new Error("cancelled"));
      if (code === 0) return resolve();
      const tail = stderr.trim().split("\n").filter(Boolean).slice(-3).join(" | ");
      reject(new Error(isCodexAuthFailure(stderr) ? `Codex is signed out. ${CODEX_SIGN_IN_HINT}` : `Codex exited with ${code}${tail ? `: ${tail}` : ""}`));
    });
    child.stdin?.end(prompt);
  });
}

export function codexAgent(host: HostEnv): Agent {
  return {
    label: "Codex",
    run: async (run: AgentRun) => {
      const binary = resolveBinary("codex", host);
      if (!binary) throw new Error("Codex is not installed");
      // Codex reads the instructions at the top of the prompt; its answer comes back as JSON, not a tool call.
      const instructions = run.system.replace(TOOL_ANSWER, JSON_ANSWER);
      const dir = await mkdtemp(join(tmpdir(), "clipcat-codex-"));
      try {
        await writeFile(join(dir, "schema.json"), JSON.stringify(ANALYSIS_SCHEMA));
        let prompt = `${instructions}\n\n${run.prompt}`;
        for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
          run.activity(attempt === 1 ? "Codex is reading the transcript" : "Codex is fixing its cuts");
          await rm(join(dir, "answer.json"), { force: true });
          await exec(binary, dir, prompt, host, run.signal);
          const raw = await readFile(join(dir, "answer.json"), "utf8").catch(() => "");
          if (!raw.trim()) throw new Error("Codex finished without an answer");
          let answer: unknown;
          try {
            answer = parseAnswer(raw);
          } catch {
            answer = { invalid: raw.slice(0, 200) };
          }
          run.activity("Checking Codex's cuts");
          const reply = await run.submit(answer);
          if (reply.done) return;
          prompt = `${instructions}\n\n${run.prompt}\n\nYour previous answer was:\n${raw.trim()}\n\nClipCat found problems with it:\n${reply.text}\n\nAnswer again with the whole corrected analysis.`;
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
