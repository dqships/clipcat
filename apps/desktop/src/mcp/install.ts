/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Adapted from Diffusion Studio's editor (apps/desktop/src/mcp-install.ts).
//
// Adds ClipCat's MCP server to the coding agents on this computer, one at a
// time as the settings screen asks, and keeps the entries pointing at this
// copy of the app when it moves or updates.

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { McpAgentValue } from "@clipcat/ipc";
import { writeFileAtomic } from "../atomic";
import {
  AGENT_TARGETS,
  type AgentId,
  type AgentPath,
  type AgentTarget,
  type McpServerSpec,
  SOCKET_ENV,
  agentTarget,
  isOurs,
  previewEntry,
  readServer,
  removeServer,
  sameSpec,
  upsertServer,
} from "./config";
import type { Seen } from "./sessions";

export type InstallEnv = {
  home: string;
  appData: string;
  /** What an agent runs: this app's executable as Node, on the bridge script. */
  spec: McpServerSpec;
  /** Whether this copy runs from a place that won't last (a quarantined, translocated macOS bundle). */
  transient: boolean;
};

/**
 * The entry for this copy of the app. A packaged app may be started by the
 * bridge when it isn't running; a development build may not, since its
 * executable is plain Electron.
 */
export function serverSpec(execPath: string, appPath: string, socket: string, packaged: boolean): McpServerSpec {
  return {
    command: execPath,
    args: [join(appPath, "dist", "mcp.cjs")],
    env: { ELECTRON_RUN_AS_NODE: "1", [SOCKET_ENV]: socket, ...(packaged ? { CLIPCAT_LAUNCH: "1" } : {}) },
  };
}

const resolvePath = (env: InstallEnv, at: AgentPath) => join(at.root === "home" ? env.home : env.appData, at.path);

async function readConfig(env: InstallEnv, target: AgentTarget): Promise<string | null> {
  try {
    return await readFile(resolvePath(env, target.config), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function writeConfig(env: InstallEnv, target: AgentTarget, text: string): Promise<void> {
  const path = resolvePath(env, target.config);
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, text);
}

const unavailable = (env: InstallEnv) => (env.transient ? "Move ClipCat to the Applications folder and open it from there first." : null);

const NEVER: Seen = { live: false, lastAt: null, client: null };

/**
 * Every agent ClipCat knows, with whether it's on this computer, whether its
 * config has ClipCat, what Connect would write, and (from `seen`) whether
 * the agent has actually opened a session.
 */
export async function mcpStatus(env: InstallEnv, seen: (id: AgentId) => Promise<Seen> = async () => NEVER): Promise<McpAgentValue[]> {
  return Promise.all(
    AGENT_TARGETS.map(async (target) => ({
      id: target.id,
      label: target.label,
      detected: existsSync(resolvePath(env, target.marker)),
      connected: readServer(await readConfig(env, target).catch(() => null), target.format) !== null,
      config: resolvePath(env, target.config),
      unavailable: unavailable(env),
      entry: previewEntry(target.format, target.entry(env.spec)),
      session: await seen(target.id),
    })),
  );
}

/** Our entry as the agent's config has it now, or null when it has none; throws when the file can't be read. */
export async function registeredEntry(env: InstallEnv, id: AgentId) {
  const target = agentTarget(id);
  return readServer(await readConfig(env, target), target.format);
}

export const configPath = (env: InstallEnv, id: AgentId) => resolvePath(env, agentTarget(id).config);

/** Writes our entry into the agent's config, or takes it out; other servers in the file are left alone. */
export async function connectAgent(env: InstallEnv, id: AgentId, connect: boolean): Promise<void> {
  const target = agentTarget(id);
  const reason = unavailable(env);
  if (connect && reason) throw new Error(reason);
  const text = await readConfig(env, target);
  try {
    const next = connect ? upsertServer(text, target.format, target.entry(env.spec)) : removeServer(text, target.format);
    if (next !== null) await writeConfig(env, target, next);
  } catch (e) {
    throw new Error(`Couldn't update ${resolvePath(env, target.config)}: ${(e as Error).message}`);
  }
}

/**
 * At launch: an entry ClipCat wrote that still runs another copy of the app
 * (one that moved, or a Windows version folder an update replaced) is
 * rewritten to run this one. Entries the user wrote by hand are left alone.
 */
export async function healRegistrations(env: InstallEnv): Promise<AgentId[]> {
  if (env.transient) return [];
  const healed: AgentId[] = [];
  for (const target of AGENT_TARGETS) {
    try {
      const text = await readConfig(env, target);
      const registered = readServer(text, target.format);
      if (!registered || !isOurs(registered) || sameSpec(registered, env.spec)) continue;
      await writeConfig(env, target, upsertServer(text, target.format, target.entry(env.spec)));
      healed.push(target.id);
    } catch {
      // Best effort: the settings screen is still there to connect it by hand.
    }
  }
  return healed;
}
