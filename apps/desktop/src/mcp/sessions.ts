// Which agents have really reached ClipCat. Every MCP session starts with a
// handshake where the client names itself (Claude Code sends "claude-code",
// the Claude app "claude-ai", Codex "codex-mcp-client", Cursor
// "cursor-vscode", VS Code "Visual Studio Code", Gemini CLI
// "gemini-cli-mcp-client"), so the settings
// screen can say "Claude Code is connected now" from what arrived on the
// socket rather than from what a config file says. The last session's time
// is kept on disk, so "last used" survives a restart.

import { readFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeFileAtomic } from "../atomic";
import type { AgentId } from "./config";

/** The name ClipCat's own check gives its client, so a check never counts as the agent using it. */
export const CHECK_CLIENT = "clipcat-check";

/** Which agent a client's handshake name belongs to; null for anything else (another client, or our own check). */
export function agentFor(client: string): AgentId | null {
  const name = client.toLowerCase();
  if (name === CHECK_CLIENT) return null;
  if (name.includes("codex")) return "codex";
  if (name.includes("claude-code") || name.includes("claude code")) return "claude-code";
  if (name === "claude-ai" || name.includes("claude desktop") || name === "claude") return "claude-desktop";
  // Cursor and Windsurf are built on VS Code, so they're told apart before it.
  if (name.includes("cursor")) return "cursor";
  if (name.includes("windsurf") || name.includes("codeium")) return "windsurf";
  if (name.includes("visual studio code") || name === "vscode") return "vscode";
  if (/lm[ -]?studio/.test(name)) return "lm-studio";
  if (name.includes("gemini")) return "gemini";
  return null;
}

export type Seen = { live: boolean; lastAt: string | null; client: string | null };

type Last = { at: string; client: string };

export class SessionLog {
  private open = new Map<AgentId, number>();
  private last: Partial<Record<AgentId, Last>> = {};
  private loaded: Promise<void>;

  /** `file` keeps the last session per agent; `changed` runs whenever an agent's state moves. */
  constructor(
    private file: string,
    private changed: () => void,
    private now: () => Date = () => new Date(),
  ) {
    this.loaded = readFile(file, "utf8").then(
      (text) => {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed === "object" && parsed !== null) this.last = parsed as Partial<Record<AgentId, Last>>;
      },
      () => {},
    );
  }

  /** Watches one server's session: counted from its handshake until it closes. */
  track(mcp: McpServer): void {
    const server = mcp.server;
    let agent: AgentId | null = null;
    server.oninitialized = () => {
      const info = server.getClientVersion();
      if (!info) return;
      agent = agentFor(info.name);
      if (agent) void this.opened(agent, `${info.name} ${info.version}`.trim());
    };
    const previous = server.onclose;
    server.onclose = () => {
      previous?.();
      if (agent) this.closed(agent);
      agent = null;
    };
  }

  async opened(agent: AgentId, client: string): Promise<void> {
    // Counted before any await, so a session that closes at once can't be left counted open.
    this.open.set(agent, (this.open.get(agent) ?? 0) + 1);
    await this.loaded;
    this.last[agent] = { at: this.now().toISOString(), client };
    await writeFileAtomic(this.file, `${JSON.stringify(this.last, null, 2)}\n`).catch(() => {});
    this.changed();
  }

  closed(agent: AgentId): void {
    const count = (this.open.get(agent) ?? 0) - 1;
    if (count > 0) this.open.set(agent, count);
    else this.open.delete(agent);
    this.changed();
  }

  async seen(agent: AgentId): Promise<Seen> {
    await this.loaded;
    const last = this.last[agent];
    return { live: this.open.has(agent), lastAt: last?.at ?? null, client: last?.client ?? null };
  }
}
