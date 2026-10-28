// Codex through `codex exec`, using the user's own signed-in Codex CLI. Each
// attempt is one non-interactive run in a read-only sandbox, in an empty
// temporary folder, held to a JSON output schema; ClipCat checks the answer
// the same way it checks Claude's, and a first answer with problems goes back
// once with the list. No MCP server, port or config change is involved.

import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentRun } from "./analyze";
import type { AgentStatus } from "./claude";
import { type HostEnv, compareVersions, killTree, needsShell, overrideBinary, parseVersion, quoteArg, runOnce, whichAll } from "./env";

/** The first release with `exec --output-schema` and `--ephemeral`. */
const MIN_VERSION = "0.100.0";
/** Runs per task at most; ClipCat's reply says when it's done, which is usually after one or two. */
const ATTEMPTS = 4;

export const CODEX_SIGN_IN_HINT = "Run `codex login` in a terminal, then try again.";

export function isCodexAuthFailure(text: string): boolean {
  return /not logged in|log ?in required|please log ?in|unauthori[sz]ed|401|authentication|expired.*token|token.*expired/i.test(text);
}

/**
 * The model Codex refused, from its stderr: a model named in config.toml that
 * this CLI or this login can't use. Null for any other failure.
 */
export function refusedModel(text: string): string | null {
  const match =
    /The '([^']+)' model is not supported/.exec(text) ?? (/model_not_found/.test(text) ? /Model metadata for `([^`]+)` not found/.exec(text) : null);
  return match?.[1] ?? null;
}

/** The ChatGPT app ships its own Codex CLI, kept current with the models it offers. */
export function bundledDirs(): string[] {
  if (process.platform !== "darwin") return [];
  return ["/Applications", join(homedir(), "Applications")].map((apps) => join(apps, "ChatGPT.app", "Contents", "Resources", "codex-cli", "bin"));
}

/** `--version` per binary, asked again only when the file changes. */
const versions = new Map<string, { mtimeMs: number; version: string | null }>();

async function versionOf(binary: string, host: HostEnv): Promise<string | null> {
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(binary).mtimeMs;
  } catch {
    // Asked every time.
  }
  const known = versions.get(binary);
  if (known && mtimeMs && known.mtimeMs === mtimeMs) return known.version;
  const version = parseVersion(await runOnce(binary, ["--version"], host)) ?? null;
  versions.set(binary, { mtimeMs, version });
  return version;
}

export type CodexBinary = { binary: string; version: string | null };

/**
 * The Codex CLI to run: `CLIPCAT_CODEX_PATH`, else the newest `codex` found.
 * The first on PATH can be a stale standalone install that the server refuses
 * the model in the user's config.toml for, while the ChatGPT app's is current.
 */
export async function resolveCodex(host: HostEnv): Promise<CodexBinary | null> {
  const override = overrideBinary("codex", host);
  if (override) return { binary: override, version: await versionOf(override, host) };
  let best: CodexBinary | null = null;
  for (const binary of whichAll("codex", { ...host, extraDirs: [...host.extraDirs, ...bundledDirs()] })) {
    const version = await versionOf(binary, host);
    if (!best || (version && (!best.version || compareVersions(version, best.version) > 0))) best = { binary, version };
  }
  return best;
}

export type CodexModels = { choices: { id: string; label: string }[]; fallback: string | null };

/** Codex's own folder: `CODEX_HOME`, else ~/.codex. */
export function codexHome(host: HostEnv): string {
  return host.env.CODEX_HOME || join(homedir(), ".codex");
}

/** The top-level `model = "…"` in config.toml, before any [table]. */
export function configModel(toml: string): string | null {
  const top = toml.split(/^\s*\[/m)[0] ?? "";
  return /^\s*model\s*=\s*["']([^"']+)["']/m.exec(top)?.[1] ?? null;
}

/** Listed models from the cache Codex keeps of what this login offers, in Codex's order. */
export function cachedModels(json: string): { id: string; label: string }[] {
  try {
    const { models } = JSON.parse(json) as { models?: { slug?: unknown; display_name?: unknown; visibility?: unknown; priority?: unknown }[] };
    return (models ?? [])
      .filter((m) => typeof m.slug === "string" && m.visibility === "list")
      .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0))
      .map((m) => ({ id: m.slug as string, label: typeof m.display_name === "string" ? m.display_name : (m.slug as string) }));
  } catch {
    return [];
  }
}

/** The models to offer for Codex, and the one config.toml runs when none is picked. */
export async function codexModels(host: HostEnv): Promise<CodexModels> {
  const home = codexHome(host);
  const [toml, cache] = await Promise.all([readFile(join(home, "config.toml"), "utf8").catch(() => ""), readFile(join(home, "models_cache.json"), "utf8").catch(() => "")]);
  return { choices: cachedModels(cache), fallback: configModel(toml) };
}

/** The model's last message as JSON, with nulls dropped so the shared schema reads it. */
export function parseAnswer(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(body, (_key, value: unknown) => (value === null ? undefined : value));
}

export async function probeCodex(host: HostEnv): Promise<AgentStatus> {
  const found = await resolveCodex(host);
  if (!found) return { status: "not-installed", version: null, detail: "Install the Codex CLI, then reopen ClipCat." };
  const { binary, version } = found;
  if (version && compareVersions(version, MIN_VERSION) < 0) {
    return { status: "outdated", version, detail: `Update Codex: ${version} is older than ${MIN_VERSION}.` };
  }
  // `codex login status` fails when there is no login; what it prints when there is one varies.
  const login = await runOnce(binary, ["login", "status"], host, 8000);
  if (login === null || /not logged in|logged out/i.test(login)) return { status: "signed-out", version, detail: CODEX_SIGN_IN_HINT };
  return { status: "ready", version, detail: null };
}

/** The arguments for one `codex exec`, with any pictures attached to the prompt. */
export function execArgs(dir: string, images: string[] = [], model: string | null = null): string[] {
  return [
    "exec",
    // Comma-separated, and right after the subcommand so the variadic option can't swallow the "-" below.
    ...(images.length > 0 ? ["--image", images.join(",")] : []),
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    ...(model ? ["--model", model] : []),
    "--output-schema",
    join(dir, "schema.json"),
    "--output-last-message",
    join(dir, "answer.json"),
    "-",
  ];
}

/** One `codex exec`: the prompt on stdin, the final message written to `out`. */
function exec(
  { binary, version }: CodexBinary,
  model: string | null,
  dir: string,
  prompt: string,
  images: string[] | undefined,
  host: HostEnv,
  signal: AbortSignal,
): Promise<void> {
  const args = execArgs(dir, images, model);
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
      const refused = refusedModel(stderr);
      if (refused) {
        const cli = version ? `Codex ${version}` : "This Codex CLI";
        const where = model ? "" : " set in ~/.codex/config.toml";
        return reject(new Error(`${cli} can't use the model "${refused}"${where}. Pick another model under AI editor, or update Codex.`));
      }
      reject(new Error(isCodexAuthFailure(stderr) ? `Codex is signed out. ${CODEX_SIGN_IN_HINT}` : `Codex exited with ${code}${tail ? `: ${tail}` : ""}`));
    });
    child.stdin?.end(prompt);
  });
}

/** `model` overrides config.toml's; null leaves Codex's default. */
export function codexAgent(host: HostEnv, model: string | null = null): Agent {
  return {
    label: "Codex",
    run: async (run: AgentRun) => {
      const binary = await resolveCodex(host);
      if (!binary) throw new Error("Codex is not installed");
      // Codex reads the instructions at the top of the prompt; its answer comes back as JSON, not a tool call.
      const instructions = `${run.system}\n\n${run.task.jsonAnswer}`;
      const dir = await mkdtemp(join(tmpdir(), "clipcat-codex-"));
      try {
        await writeFile(join(dir, "schema.json"), JSON.stringify(run.task.jsonSchema));
        let prompt = `${instructions}\n\n${run.prompt}`;
        let images = run.images;
        for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
          run.activity(attempt > 1 ? "Codex is fixing its answer" : run.images?.length ? "Codex is looking at your media" : "Codex is reading the transcript");
          await rm(join(dir, "answer.json"), { force: true });
          await exec(binary, model, dir, prompt, images, host, run.signal);
          const raw = await readFile(join(dir, "answer.json"), "utf8").catch(() => "");
          if (!raw.trim()) throw new Error("Codex finished without an answer");
          let answer: unknown;
          try {
            answer = parseAnswer(raw);
          } catch {
            answer = { invalid: raw.slice(0, 200) };
          }
          run.activity("Checking Codex's answer");
          const reply = await run.submit(answer);
          if (reply.done) return;
          // A reply with pictures (a slide's stills) replaces the prompt's own.
          images = reply.images?.length ? reply.images : run.images;
          const about = reply.images?.length ? "ClipCat rendered it; the attached images are how it looks. ClipCat says" : "ClipCat found problems with it";
          prompt = `${instructions}\n\n${run.prompt}\n\nYour previous answer was:\n${raw.trim()}\n\n${about}:\n${reply.text}\n\nAnswer again with the whole answer.`;
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
