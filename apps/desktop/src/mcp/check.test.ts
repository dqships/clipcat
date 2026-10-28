import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildSync } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inheritedEnv } from "../ai/env";
import { type CliResult, checkAgent, claudeVerdict, codexVerdict, tilde } from "./check";
import { type InstallEnv, connectAgent, serverSpec } from "./install";
import { listen, socketPath } from "./socket";

let dir: string;
let server: Server;
let env: InstallEnv;
const sock = () => (process.platform === "win32" ? socketPath(dir, "win32") : join(dir, "mcp.sock"));
const host = inheritedEnv();

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "clipcat-check-"));
  // The bridge where a packaged app keeps it, run by this Node as the app's executable would be.
  buildSync({ entryPoints: [join(__dirname, "bridge.ts")], bundle: true, platform: "node", format: "cjs", outfile: join(dir, "app", "dist", "mcp.cjs"), logLevel: "silent" });
  server = await listen(sock(), () => {
    const s = new McpServer({ name: "clipcat", title: "ClipCat", version: "9.9.9" });
    s.registerTool("list_projects", { description: "Lists" }, async () => ({ content: [{ type: "text", text: "[]" }] }));
    s.registerTool("cut_words", { description: "Cuts" }, async () => ({ content: [{ type: "text", text: "ok" }] }));
    return s;
  });
  env = { home: join(dir, "home"), appData: join(dir, "appData"), spec: serverSpec(process.execPath, join(dir, "app"), sock(), true), transient: false };
  await mkdir(env.home, { recursive: true });
});
afterAll(async () => {
  await new Promise((r) => server?.close(r));
  await rm(dir, { recursive: true, force: true });
});

const cli = (answers: Record<string, CliResult>) => async (_bin: string, args: string[]) => answers[args.join(" ")] ?? { code: 1, out: "unexpected" };

describe("checking a connection", () => {
  it("proves each step: the file, the run through to ClipCat, and the agent's own view", async () => {
    await connectAgent(env, "codex", true);
    const steps = await checkAgent("codex", {
      env,
      host: { ...host, env: { ...host.env, CLIPCAT_CODEX_PATH: process.execPath } },
      platform: "darwin",
      run: cli({ "mcp get clipcat --json": { code: 0, out: JSON.stringify({ name: "clipcat", enabled: true, transport: { type: "stdio" } }) } }),
    });
    expect(steps).toEqual([
      { id: "saved", state: "ok", text: `Saved in ${tilde(env.home, join(env.home, ".codex", "config.toml"))}.` },
      { id: "reaches", state: "ok", text: "ClipCat 9.9.9 answered with 2 tools." },
      { id: "agent", state: "ok", text: "Codex lists it, turned on (codex mcp get clipcat)." },
    ]);
  });

  it("says when the entry doesn't reach this ClipCat", async () => {
    const elsewhere = { ...env, spec: serverSpec(process.execPath, join(dir, "app"), join(dir, "nobody.sock"), true) };
    await connectAgent(elsewhere, "claude-desktop", true);
    const steps = await checkAgent("claude-desktop", { env: elsewhere, host, platform: "darwin" });
    expect(steps[0]!.state).toBe("ok");
    expect(steps[1]).toMatchObject({ id: "reaches", state: "failed" });
    expect(steps[1]!.text).toMatch(/ClipCat isn't running/);
    // The Claude app has no command line to ask; it needs a restart.
    expect(steps[2]).toMatchObject({ id: "agent", state: "waiting" });
    expect(steps[2]!.text).toMatch(/⌘Q/);
  });

  it("fails without an entry, and flags one that runs another copy", async () => {
    const none = await checkAgent("claude-code", { env, host, platform: "darwin" });
    expect(none.map((s) => s.state)).toEqual(["failed", "skipped", "skipped"]);
    await writeFile(join(env.home, ".claude.json"), JSON.stringify({ mcpServers: { clipcat: { command: "/old/ClipCat", args: [], env: { CLIPCAT_SOCKET: sock() } } } }));
    const old = await checkAgent("claude-code", { env, host: { ...host, env: { ...host.env, PATH: "" }, extraDirs: [] }, platform: "darwin" });
    expect(old[0]).toMatchObject({ state: "failed" });
    expect(old[0]!.text).toMatch(/\/old\/ClipCat, not this copy/);
    expect(old[1]).toMatchObject({ state: "failed" });
    expect(old[2]).toMatchObject({ state: "skipped" });
  });
});

describe("reading what the agents' CLIs say", () => {
  it("reads claude mcp get", () => {
    const ok = "clipcat:\n  Scope: User config (available in all your projects)\n  Status: √ Connected\n  Type: stdio\n";
    expect(claudeVerdict({ code: 0, out: ok })).toMatchObject({ state: "ok" });
    expect(claudeVerdict({ code: 0, out: ok.replace("√", "✓") })).toMatchObject({ state: "ok" });
    const failed = "clipcat:\n  Status: × Failed to connect\n  Issue: ENOENT: no such file or directory, posix_spawn '/nope/ClipCat'\n";
    expect(claudeVerdict({ code: 0, out: failed })).toEqual({
      id: "agent",
      state: "failed",
      text: `Claude Code says "Failed to connect": ENOENT: no such file or directory, posix_spawn '/nope/ClipCat'`,
    });
    expect(claudeVerdict({ code: 1, out: 'No MCP server named "clipcat". Configured servers: other' }).text).toMatch(/doesn't see it: No MCP server named/);
    expect(claudeVerdict({ code: null, out: "" }).text).toMatch(/didn't answer/);
  });

  it("reads codex mcp get --json, past its warnings", () => {
    const warn = "WARNING: proceeding, even though we could not create PATH aliases\n";
    expect(codexVerdict({ code: 0, out: `${warn}{"name":"clipcat","enabled":true}` })).toMatchObject({ state: "ok" });
    expect(codexVerdict({ code: 0, out: `{"name":"clipcat","enabled":false,"disabled_reason":"startup failed"}` }).text).toMatch(/turned off \(startup failed\)/);
    expect(codexVerdict({ code: 1, out: `${warn}Error: No MCP server named 'clipcat' found.\n\nStack backtrace:` }).text).toBe(
      "Codex doesn't see it: No MCP server named 'clipcat' found.",
    );
  });
});
