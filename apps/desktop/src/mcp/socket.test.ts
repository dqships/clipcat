import { execFileSync } from "node:child_process";
import { buildSync } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Server } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listen, socketPath } from "./socket";

let dir: string;
let bridge: string;
let server: Server;
const counts: number[] = [];
const path = () => (process.platform === "win32" ? socketPath(dir, "win32") : join(dir, "mcp.sock"));

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "clipcat-sock-"));
  bridge = join(dir, "mcp.cjs");
  buildSync({ entryPoints: [join(__dirname, "bridge.ts")], bundle: true, platform: "node", format: "cjs", outfile: bridge, logLevel: "silent" });
  server = await listen(path(), () => {
    const s = new McpServer({ name: "clipcat", version: "0" });
    s.registerTool("ping", { description: "Answers pong" }, async () => ({ content: [{ type: "text", text: "pong" }] }));
    return s;
  }, process.platform, (open) => counts.push(open));
});
afterAll(async () => {
  await new Promise((r) => server?.close(r));
  await rm(dir, { recursive: true, force: true });
});

const connect = async (socket: string) => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [bridge], env: { ...(process.env as Record<string, string>), CLIPCAT_SOCKET: socket }, stderr: "pipe" });
  const client = new Client({ name: "test", version: "1" });
  await client.connect(transport);
  return client;
};

describe("the socket and the bridge", () => {
  it("keeps socket paths short enough for macOS", () => {
    expect(socketPath("/Users/me/Library/Application Support/ClipCat", "darwin")).toBe("/Users/me/Library/Application Support/ClipCat/mcp.sock");
    expect(Buffer.byteLength(socketPath(`/${"x".repeat(120)}`, "darwin"))).toBeLessThanOrEqual(100);
    expect(socketPath("C:\\Users\\me\\AppData\\Roaming\\ClipCat", "win32")).toMatch(/^\\\\\.\\pipe\\clipcat-[0-9a-f]{16}$/);
  });

  it("carries a whole MCP session through, two at once", async () => {
    const [a, b] = await Promise.all([connect(path()), connect(path())]);
    for (const client of [a, b]) {
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["ping"]);
      expect(await client.callTool({ name: "ping", arguments: {} })).toMatchObject({ content: [{ text: "pong" }] });
    }
    await Promise.all([a.close(), b.close()]);
    // A ClipCat started in the background for an agent leaves when the count is back to 0.
    await expect.poll(() => counts.at(-1)).toBe(0);
    expect(Math.max(...counts)).toBe(2);
  });

  it("says plainly when the app isn't running", () => {
    let stderr = "";
    try {
      execFileSync(process.execPath, [bridge], { env: { ...process.env, CLIPCAT_SOCKET: join(dir, "nobody.sock") }, stdio: "pipe" });
    } catch (e) {
      stderr = String((e as { stderr: Buffer }).stderr);
    }
    expect(stderr).toMatch(/ClipCat isn't running/);
  });
});
