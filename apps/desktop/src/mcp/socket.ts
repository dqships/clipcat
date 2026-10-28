// Where outside agents reach ClipCat: a Unix socket in the app's data folder
// (a named pipe on Windows), only open to this user. Each connection is one
// agent session with its own server, speaking MCP's stdio framing, which is
// all the bridge pipes through.

import { createHash } from "node:crypto";
import { chmod, unlink } from "node:fs/promises";
import { type Server, type Socket, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

/** macOS refuses socket paths over 104 bytes, Linux over 108; keep well under both. */
const MAX_SOCKET_PATH = 100;

export function socketPath(userData: string, platform: NodeJS.Platform): string {
  const hash = createHash("sha256").update(userData).digest("hex").slice(0, 16);
  if (platform === "win32") return `\\\\.\\pipe\\clipcat-${hash}`;
  const inData = join(userData, "mcp.sock");
  return Buffer.byteLength(inData) <= MAX_SOCKET_PATH ? inData : join(tmpdir(), `clipcat-${hash}.sock`);
}

/**
 * Listens on `path`, giving each connection its own server from `create`.
 * A socket file left by a crash is removed first; the app's single-instance
 * lock means nothing else is listening on it.
 */
export async function listen(path: string, create: () => McpServer, platform: NodeJS.Platform = process.platform): Promise<Server> {
  if (platform !== "win32") await unlink(path).catch(() => {});
  const sessions = new Set<Socket>();
  const server = createServer((socket) => {
    sessions.add(socket);
    const mcp = create();
    const transport = new StdioServerTransport(socket, socket);
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      sessions.delete(socket);
      void mcp.close().catch(() => {});
    });
    void mcp.connect(transport).catch(() => socket.destroy());
  });
  server.on("close", () => {
    for (const s of sessions) s.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolve();
    });
  });
  if (platform !== "win32") await chmod(path, 0o600);
  return server;
}
