// The command an outside agent runs to reach ClipCat: ClipCat's own
// executable as Node (ELECTRON_RUN_AS_NODE=1) on this script, bundled to
// dist/mcp.cjs. It pipes the agent's stdin and stdout to the app's socket
// and looks at nothing passing through. When the app isn't running, a
// packaged build (CLIPCAT_LAUNCH=1) starts it in the background, with no
// window, and waits for the socket: the Claude desktop app starts every MCP
// server as it opens, and that shouldn't put ClipCat on the screen.
// Stdout belongs to the protocol; anything for a person goes to stderr.

import { spawn } from "node:child_process";
import { type Socket, connect } from "node:net";
import { BACKGROUND_ARG } from "./config";

const WAIT_MS = 30_000;

function attempt(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    socket.once("connect", () => {
      socket.off("error", reject);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

/** Whether the error means nobody is listening yet, rather than something worse. */
const isDown = (e: unknown) => ["ENOENT", "ECONNREFUSED"].includes((e as NodeJS.ErrnoException).code ?? "");

function launchApp(): void {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLIPCAT_SOCKET;
  delete env.CLIPCAT_LAUNCH;
  spawn(process.execPath, [BACKGROUND_ARG], { detached: true, stdio: "ignore", env }).unref();
}

async function open(path: string, launch: boolean): Promise<Socket> {
  try {
    return await attempt(path);
  } catch (e) {
    if (!isDown(e) || !launch) throw e;
  }
  launchApp();
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      return await attempt(path);
    } catch (e) {
      if (!isDown(e) || Date.now() > deadline) throw e;
    }
  }
}

async function main(): Promise<void> {
  const path = process.env.CLIPCAT_SOCKET;
  if (!path) throw new Error("CLIPCAT_SOCKET isn't set. Connect the agent again from ClipCat's settings.");
  let socket: Socket;
  try {
    socket = await open(path, process.env.CLIPCAT_LAUNCH === "1");
  } catch (e) {
    throw new Error(isDown(e) ? "ClipCat isn't running. Open ClipCat, then try again." : (e as Error).message);
  }
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  // The app went away (quit, or ended the session): the agent sees EOF.
  socket.on("close", () => process.exit(0));
  socket.on("error", (e) => {
    process.stderr.write(`[clipcat mcp] ${e.message}\n`);
    process.exit(1);
  });
  // The agent went away: end the session.
  process.stdin.on("end", () => socket.end());
}

main().catch((e: unknown) => {
  process.stderr.write(`[clipcat mcp] ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
