import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type InstallEnv, connectAgent, healRegistrations, mcpStatus, serverSpec } from "./install";

let root: string;
let env: InstallEnv;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "clipcat-mcp-"));
  env = { home: join(root, "home"), appData: join(root, "appData"), spec: serverSpec("/app/ClipCat", "/app/app.asar", "/data/mcp.sock", true), transient: false };
  await mkdir(join(env.home, ".claude"), { recursive: true });
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("MCP install", () => {
  it("builds the entry: the app as Node on the bridge, launching a packaged app", () => {
    expect(env.spec).toEqual({ command: "/app/ClipCat", args: [join("/app/app.asar", "dist", "mcp.cjs")], env: { ELECTRON_RUN_AS_NODE: "1", CLIPCAT_SOCKET: "/data/mcp.sock", CLIPCAT_LAUNCH: "1" } });
    expect(serverSpec("/e", "/a", "/s", false).env).not.toHaveProperty("CLIPCAT_LAUNCH");
  });

  it("detects agents, connects and disconnects one", async () => {
    const before = await mcpStatus(env);
    expect(before.map((a) => [a.id, a.detected, a.connected])).toEqual([
      ["claude-code", true, false],
      ["codex", false, false],
      ["claude-desktop", false, false],
    ]);
    await writeFile(join(env.home, ".claude.json"), JSON.stringify({ theme: "dark" }));
    await connectAgent(env, "claude-code", true);
    const written = JSON.parse(await readFile(join(env.home, ".claude.json"), "utf8"));
    expect(written.theme).toBe("dark");
    expect(written.mcpServers.clipcat.command).toBe("/app/ClipCat");
    expect((await mcpStatus(env))[0]!.connected).toBe(true);

    await connectAgent(env, "codex", true);
    expect(await readFile(join(env.home, ".codex", "config.toml"), "utf8")).toContain("[mcp_servers.clipcat]");

    await connectAgent(env, "claude-code", false);
    expect(JSON.parse(await readFile(join(env.home, ".claude.json"), "utf8")).mcpServers).toEqual({});
  });

  it("won't connect from a translocated copy", async () => {
    await expect(connectAgent({ ...env, transient: true }, "claude-code", true)).rejects.toThrow(/Applications/);
  });

  it("says which file it couldn't read", async () => {
    await writeFile(join(env.home, ".claude.json"), "{ broken");
    await expect(connectAgent(env, "claude-code", true)).rejects.toThrow(/\.claude\.json/);
  });

  it("points our old entries at this copy, and leaves hand-written ones alone", async () => {
    const old = { ...env, spec: serverSpec("/old/ClipCat", "/old/app.asar", "/data/mcp.sock", true) };
    await connectAgent(old, "claude-code", true);
    await mkdir(join(env.home, ".codex"), { recursive: true });
    await writeFile(join(env.home, ".codex", "config.toml"), `[mcp_servers.clipcat]\ncommand = "my-own"\n`);
    expect(await healRegistrations(env)).toEqual(["claude-code"]);
    expect(JSON.parse(await readFile(join(env.home, ".claude.json"), "utf8")).mcpServers.clipcat.command).toBe("/app/ClipCat");
    expect(await readFile(join(env.home, ".codex", "config.toml"), "utf8")).toContain('command = "my-own"');
    expect(await healRegistrations(env)).toEqual([]);
  });
});
