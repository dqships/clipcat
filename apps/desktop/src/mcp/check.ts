// Checking an agent's connection for real, instead of trusting that a file
// was written. Three steps, each proved or not:
//
//   saved    the agent's config file has our entry, read back from disk;
//   reaches  that entry, run exactly as the agent would run it, completes an
//            MCP handshake with this ClipCat and lists its tools;
//   agent    the agent itself agrees: `claude mcp get` connects to it, and
//            `codex mcp get` lists it switched on. The Claude app and the
//            editors have no command line to ask, so they wait for a restart.
//
// Whether the agent has used it since is the session log's job (sessions.ts).

import { execFile } from "node:child_process";
import { relative, sep } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpCheckStepValue } from "@clipcat/ipc";
import { type HostEnv, needsShell, quoteArg, resolveBinary } from "../ai/env";
import { type AgentId, type Registered, agentTarget, sameSpec } from "./config";
import { type InstallEnv, configPath, registeredEntry } from "./install";
import { CHECK_CLIENT } from "./sessions";

type Step = McpCheckStepValue;

/** What a CLI printed (stdout then stderr) and how it exited; code is null when it couldn't start or timed out. */
export type CliResult = { code: number | null; out: string };

export type CheckDeps = {
  env: InstallEnv;
  host: HostEnv;
  platform: NodeJS.Platform;
  /** Runs an agent CLI; replaced in tests. */
  run?: (bin: string, args: string[]) => Promise<CliResult>;
  /** Runs an entry through to ClipCat; replaced in tests. */
  reach?: (entry: Registered) => Promise<string>;
};

const HANDSHAKE_MS = 15_000;
const CLI_MS = 45_000;

/** A path under the home folder as ~/…, the way people read it. */
export function tilde(home: string, path: string): string {
  const rel = relative(home, path);
  return rel && !rel.startsWith("..") ? `~${sep}${rel}` : path;
}

export function runCli(host: HostEnv, timeoutMs = CLI_MS) {
  return (bin: string, args: string[]): Promise<CliResult> =>
    new Promise((done) => {
      const child = execFile(
        needsShell(bin) ? `"${bin}"` : bin,
        args.map(quoteArg),
        { timeout: timeoutMs, encoding: "utf8", env: host.env, windowsHide: true, shell: needsShell(bin) },
        (error, stdout, stderr) => {
          const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
          done({ code, out: `${stdout}${stderr ? `\n${stderr}` : ""}`.trim() });
        },
      );
      child.on("error", () => done({ code: null, out: "" }));
    });
}

/**
 * Runs the entry the agent's config has, as the agent would (but never
 * launching ClipCat, which is already open), through the handshake and a
 * tool listing. Resolves with what answered; rejects with why not.
 */
export function reachEntry(host: HostEnv) {
  return async (entry: Registered): Promise<string> => {
    const { CLIPCAT_LAUNCH: _launch, ...env } = entry.env;
    const transport = new StdioClientTransport({ command: entry.command, args: entry.args, env: { ...host.env, ...env }, stderr: "pipe" });
    let stderr = "";
    transport.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    const client = new Client({ name: CHECK_CLIENT, version: "1" });
    try {
      await client.connect(transport, { timeout: HANDSHAKE_MS });
      const { tools } = await client.listTools(undefined, { timeout: HANDSHAKE_MS });
      const server = client.getServerVersion();
      return `${server?.title ?? server?.name ?? "ClipCat"} ${server?.version ?? ""}`.trim() + ` answered with ${tools.length} tools.`;
    } catch (e) {
      const why = stderr.replace(/\[clipcat mcp\]\s*/g, "").trim() || (e instanceof Error ? e.message : String(e));
      throw new Error(why);
    } finally {
      await client.close().catch(() => {});
    }
  };
}

const firstLine = (text: string) => text.split("\n").find((l) => l.trim())?.trim() ?? "";

/** What `claude mcp get clipcat` says: its Status line, and the Issue line when it failed. */
export function claudeVerdict(result: CliResult): Step {
  const status = /^\s*Status:\s*(.+)$/m.exec(result.out)?.[1]?.trim();
  const issue = /^\s*Issue:\s*(.+)$/m.exec(result.out)?.[1]?.trim();
  if (status && /connected/i.test(status) && !/fail/i.test(status)) {
    return { id: "agent", state: "ok", text: "Claude Code connected to it (claude mcp get clipcat)." };
  }
  if (status) return { id: "agent", state: "failed", text: `Claude Code says "${status.replace(/^\W+\s*/, "")}"${issue ? `: ${issue}` : "."}` };
  if (result.code === null) return { id: "agent", state: "failed", text: "claude mcp get clipcat didn't answer in time." };
  return { id: "agent", state: "failed", text: `Claude Code doesn't see it: ${firstLine(result.out) || `exit ${result.code}`}` };
}

function parseObject(text: string): { enabled?: unknown; disabled_reason?: unknown } | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/** What `codex mcp get clipcat --json` says: listed, and switched on. */
export function codexVerdict(result: CliResult): Step {
  const entry = result.code === 0 ? parseObject(result.out.slice(result.out.indexOf("{"))) : null;
  if (entry && entry.enabled === false) {
    const reason = typeof entry.disabled_reason === "string" ? ` (${entry.disabled_reason})` : "";
    return { id: "agent", state: "failed", text: `Codex lists it but has it turned off${reason}. Set enabled = true under [mcp_servers.clipcat].` };
  }
  if (entry) return { id: "agent", state: "ok", text: "Codex lists it, turned on (codex mcp get clipcat)." };
  if (result.code === null) return { id: "agent", state: "failed", text: "codex mcp get clipcat didn't answer in time." };
  const said = result.out.split("\n").find((l) => /error|no mcp server/i.test(l))?.trim() ?? firstLine(result.out);
  return { id: "agent", state: "failed", text: `Codex doesn't see it: ${said.replace(/^Error:\s*/, "") || `exit ${result.code}`}` };
}

/** What each agent without a CLI to ask needs before it loads the file. */
function restartStep(id: Exclude<AgentId, "claude-code" | "codex">, platform: NodeJS.Platform): Step {
  const mac = platform === "darwin";
  const text: Record<typeof id, string> = {
    "claude-desktop": `The Claude app reads this file only when it opens. ${mac ? "Quit it with ⌘Q" : "Quit it from the tray icon"} and open it again.`,
    cursor: "Cursor loads it in a new window or after a restart. In Cursor Settings, MCP should list clipcat with its tools.",
    vscode: "VS Code loads it in a new window. Run MCP: List Servers from the Command Palette and start clipcat if it isn't running.",
    windsurf: "Windsurf loads it after a restart, or when you refresh the MCP servers in Cascade.",
    "lm-studio": `LM Studio loads it when it opens. ${mac ? "Quit it with ⌘Q" : "Quit it"} and open it again, then turn on clipcat in a chat's integrations.`,
    gemini: "Gemini CLI loads it when it starts. Start a new gemini session and type /mcp.",
  };
  return { id: "agent", state: "waiting", text: text[id] };
}

async function agentStep(id: AgentId, deps: Required<CheckDeps>): Promise<Step> {
  if (id !== "claude-code" && id !== "codex") return restartStep(id, deps.platform);
  const name = id === "claude-code" ? "claude" : "codex";
  const bin = resolveBinary(name, deps.host);
  if (!bin) {
    const label = agentTarget(id).label;
    return { id: "agent", state: "skipped", text: `${label}'s command line isn't installed, so ClipCat can't ask it. A new ${label} session loads the file when it starts.` };
  }
  return id === "claude-code"
    ? claudeVerdict(await deps.run(bin, ["mcp", "get", "clipcat"]))
    : codexVerdict(await deps.run(bin, ["mcp", "get", "clipcat", "--json"]));
}

export async function checkAgent(id: AgentId, deps: CheckDeps): Promise<Step[]> {
  const full: Required<CheckDeps> = { run: runCli(deps.host), reach: reachEntry(deps.host), ...deps };
  const where = tilde(deps.env.home, configPath(deps.env, id));
  let entry: Registered | null;
  try {
    entry = await registeredEntry(deps.env, id);
  } catch (e) {
    return [
      { id: "saved", state: "failed", text: `Couldn't read ${where}: ${(e as Error).message}` },
      { id: "reaches", state: "skipped", text: "Not tried." },
      { id: "agent", state: "skipped", text: "Not tried." },
    ];
  }
  if (!entry) {
    return [
      { id: "saved", state: "failed", text: `${where} has no ClipCat entry. Connect again.` },
      { id: "reaches", state: "skipped", text: "Not tried." },
      { id: "agent", state: "skipped", text: "Not tried." },
    ];
  }
  const saved: Step = sameSpec(entry, deps.env.spec)
    ? { id: "saved", state: "ok", text: `Saved in ${where}.` }
    : { id: "saved", state: "failed", text: `${where} runs ClipCat from ${entry.command}, not this copy. Disconnect and connect again to point it here.` };
  const reaches: Step = await full.reach(entry).then(
    (answer): Step => ({ id: "reaches", state: "ok", text: answer }),
    (e: unknown): Step => ({ id: "reaches", state: "failed", text: `It didn't reach ClipCat: ${e instanceof Error ? e.message : String(e)}` }),
  );
  return [saved, reaches, await agentStep(id, full)];
}
