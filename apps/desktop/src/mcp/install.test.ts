import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type InstallEnv, connectAgent, healRegistrations, mcpSetup, mcpStatus, serverSpec } from "./install";

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
      ["cursor", false, false],
      ["vscode", false, false],
      ["windsurf", false, false],
      ["lm-studio", false, false],
      ["gemini", false, false],
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

  it("writes each editor's own file, keeping its other settings", async () => {
    await mkdir(join(env.appData, "Code", "User"), { recursive: true });
    await writeFile(join(env.appData, "Code", "User", "mcp.json"), JSON.stringify({ servers: { other: { command: "x" } }, inputs: [] }));
    await mkdir(join(env.home, ".gemini"), { recursive: true });
    await writeFile(join(env.home, ".gemini", "settings.json"), JSON.stringify({ theme: "GitHub" }));
    for (const id of ["cursor", "vscode", "windsurf", "lm-studio", "gemini"] as const) await connectAgent(env, id, true);

    const read = async (...path: string[]) => JSON.parse(await readFile(join(...path), "utf8"));
    const vscode = await read(env.appData, "Code", "User", "mcp.json");
    expect(vscode.servers.other).toEqual({ command: "x" });
    expect(vscode.inputs).toEqual([]);
    expect(vscode.servers.clipcat).toMatchObject({ type: "stdio", command: "/app/ClipCat" });
    expect(vscode).not.toHaveProperty("mcpServers");
    expect((await read(env.home, ".cursor", "mcp.json")).mcpServers.clipcat.command).toBe("/app/ClipCat");
    expect((await read(env.home, ".codeium", "windsurf", "mcp_config.json")).mcpServers.clipcat.command).toBe("/app/ClipCat");
    expect((await read(env.home, ".lmstudio", "mcp.json")).mcpServers.clipcat.command).toBe("/app/ClipCat");
    const gemini = await read(env.home, ".gemini", "settings.json");
    expect(gemini.theme).toBe("GitHub");
    expect(gemini.mcpServers.clipcat.env.CLIPCAT_SOCKET).toBe("/data/mcp.sock");

    const status = await mcpStatus(env);
    expect(status.filter((a) => a.connected).map((a) => a.id)).toEqual(["cursor", "vscode", "windsurf", "lm-studio", "gemini"]);
    expect(status.find((a) => a.id === "vscode")!.entry).toContain('"servers"');
    expect(status.find((a) => a.id === "gemini")!.detected).toBe(true);
  });

  it("won't rewrite a file with comments in it", async () => {
    await mkdir(join(env.appData, "Code", "User"), { recursive: true });
    await writeFile(join(env.appData, "Code", "User", "mcp.json"), `{\n  // mine\n  "servers": {}\n}\n`);
    await expect(connectAgent(env, "vscode", true)).rejects.toThrow(/by hand/);
  });

  it("gives the setup for any other app", () => {
    const setup = mcpSetup(env);
    expect(setup.command).toBe("/app/ClipCat");
    expect(setup.env.CLIPCAT_SOCKET).toBe("/data/mcp.sock");
    expect(JSON.parse(setup.json).mcpServers.clipcat).toEqual({ command: setup.command, args: setup.args, env: setup.env });
    expect(mcpSetup({ ...env, transient: true }).unavailable).toMatch(/Applications/);
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
