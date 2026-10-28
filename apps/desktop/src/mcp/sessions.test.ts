import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_CLIENT, SessionLog, agentFor } from "./sessions";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clipcat-sessions-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/** One MCP session from a client calling itself `name`, tracked by `log`. */
async function session(log: SessionLog, name: string) {
  const server = new McpServer({ name: "clipcat", version: "0" });
  log.track(server);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name, version: "2.1.312" });
  await client.connect(b);
  return client;
}

describe("agent sessions", () => {
  it("knows each agent by the name its client sends", () => {
    expect(agentFor("claude-code")).toBe("claude-code");
    expect(agentFor("codex-mcp-client")).toBe("codex");
    expect(agentFor("claude-ai")).toBe("claude-desktop");
    expect(agentFor(CHECK_CLIENT)).toBeNull();
    expect(agentFor("cursor")).toBeNull();
  });

  it("is live while a session is open, then remembers it, across restarts", async () => {
    const changed = vi.fn();
    const file = join(dir, "agent-sessions.json");
    const now = new Date("2026-10-28T11:42:00Z");
    const log = new SessionLog(file, changed, () => now);
    expect(await log.seen("claude-code")).toEqual({ live: false, lastAt: null, client: null });

    const client = await session(log, "claude-code");
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(await log.seen("claude-code")).toEqual({ live: true, lastAt: now.toISOString(), client: "claude-code 2.1.312" });
    // Our own check isn't the agent using it.
    await session(log, CHECK_CLIENT);
    expect((await log.seen("codex")).lastAt).toBeNull();

    await client.close();
    await vi.waitFor(async () => expect((await log.seen("claude-code")).live).toBe(false));
    expect(changed).toHaveBeenCalledTimes(2);

    const later = new SessionLog(file, () => {});
    expect(await later.seen("claude-code")).toEqual({ live: false, lastAt: now.toISOString(), client: "claude-code 2.1.312" });
  });
});
