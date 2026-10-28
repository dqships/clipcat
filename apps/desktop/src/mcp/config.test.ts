import { describe, expect, it } from "vitest";
import { agentTarget, isOurs, readServer, removeServer, sameSpec, upsertServer } from "./config";

const spec = { command: "/Applications/ClipCat.app/Contents/MacOS/ClipCat", args: ["/Applications/ClipCat.app/Contents/Resources/app.asar/dist/mcp.cjs"], env: { ELECTRON_RUN_AS_NODE: "1", CLIPCAT_SOCKET: "/Users/me/Library/Application Support/ClipCat/mcp.sock" } };
const claude = agentTarget("claude-code");
const codex = agentTarget("codex");

describe("JSON configs", () => {
  it("adds our entry and keeps everything else", () => {
    const before = JSON.stringify({ numStartups: 3, mcpServers: { other: { command: "x" } } });
    const after = JSON.parse(upsertServer(before, "mcpServers", claude.entry(spec)));
    expect(after.numStartups).toBe(3);
    expect(after.mcpServers.other).toEqual({ command: "x" });
    expect(after.mcpServers.clipcat).toEqual({ type: "stdio", ...spec });
  });

  it("reads back what it wrote, and removes only ours", () => {
    const text = upsertServer(JSON.stringify({ mcpServers: { other: { command: "x" } } }), "mcpServers", claude.entry(spec));
    const registered = readServer(text, "mcpServers")!;
    expect(sameSpec(registered, spec)).toBe(true);
    expect(isOurs(registered)).toBe(true);
    expect(JSON.parse(removeServer(text, "mcpServers")!).mcpServers).toEqual({ other: { command: "x" } });
    expect(removeServer(JSON.stringify({ mcpServers: {} }), "mcpServers")).toBeNull();
  });

  it("starts a missing file, and refuses one it can't parse", () => {
    expect(JSON.parse(upsertServer(null, "mcpServers", claude.entry(spec))).mcpServers.clipcat.command).toBe(spec.command);
    expect(() => upsertServer("{ not json", "mcpServers", claude.entry(spec))).toThrow();
  });

  it("knows a hand-written entry under our name isn't ours", () => {
    const text = JSON.stringify({ mcpServers: { clipcat: { command: "npx", args: ["something"] } } });
    expect(isOurs(readServer(text, "mcpServers")!)).toBe(false);
  });
});

describe("Codex's TOML", () => {
  const existing = `model = "gpt-6"\n\n[mcp_servers.docs]\ncommand = "docs"\n\n[profiles.fast]\nmodel = "mini"\n`;

  it("appends our table with env as an inline table", () => {
    const text = upsertServer(existing, "toml", codex.entry(spec));
    expect(text.startsWith(existing)).toBe(true);
    expect(text).toContain(`[mcp_servers.clipcat]\ncommand = "${spec.command}"`);
    expect(text).toContain(`env = { ELECTRON_RUN_AS_NODE = "1", CLIPCAT_SOCKET = "${spec.env.CLIPCAT_SOCKET}" }`);
    expect(sameSpec(readServer(text, "toml")!, spec)).toBe(true);
  });

  it("replaces our table in place, sub-tables and all, and removes it cleanly", () => {
    const hand = `${existing}\n[mcp_servers.clipcat]\ncommand = "old"\n\n[mcp_servers.clipcat.env]\nCLIPCAT_SOCKET = "/old.sock"\n\n[tail]\nx = "y"\n`;
    expect(readServer(hand, "toml")).toEqual({ command: "old", args: [], env: { CLIPCAT_SOCKET: "/old.sock" } });
    const text = upsertServer(hand, "toml", codex.entry(spec));
    expect(text.match(/\[mcp_servers\.clipcat/g)).toHaveLength(1);
    expect(text.indexOf("[mcp_servers.clipcat]")).toBeLessThan(text.indexOf("[tail]"));
    expect(sameSpec(readServer(text, "toml")!, spec)).toBe(true);
    const removed = removeServer(text, "toml")!;
    expect(removed).not.toContain("clipcat");
    expect(removed).toContain('[tail]\nx = "y"');
    expect(removed).not.toMatch(/\n{3,}/);
  });

  it("escapes Windows paths", () => {
    const win = { command: "C:\\Users\\me\\AppData\\Local\\ClipCat\\app-0.1.0\\ClipCat.exe", args: ["C:\\x\\mcp.cjs"], env: { CLIPCAT_SOCKET: "\\\\.\\pipe\\clipcat-ab" } };
    const text = upsertServer(null, "toml", codex.entry(win));
    expect(text).toContain('command = "C:\\\\Users\\\\me');
    expect(readServer(text, "toml")).toEqual(win);
  });
});
