/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Adapted from Diffusion Studio's editor (apps/desktop/src/mcp-config.ts).
//
// How ClipCat's MCP server is written into each agent's config, as pure text
// transforms: no file system, no Electron, so the merge rules are testable.
// install.ts decides which files and does the I/O.
//
// Every agent gets the same stdio entry: ClipCat's own executable run as
// Node (ELECTRON_RUN_AS_NODE) on the bridge script, which pipes the agent's
// stdin and stdout to the socket the app listens on. No port, no token: the
// socket is only reachable by this user.

import type { McpAgentIdValue } from "@clipcat/ipc";

export type AgentId = McpAgentIdValue;

/** What an agent runs to reach ClipCat. */
export type McpServerSpec = { command: string; args: string[]; env: Record<string, string> };

/**
 * The key our entry lives under in every agent's server map, and so the
 * namespace the agent shows the tools under: `mcp__clipcat__<tool>`.
 */
export const SERVER_NAME = "clipcat";

/** The env var only our entry carries: it marks an entry as ours, wherever the app was when it was written. */
export const SOCKET_ENV = "CLIPCAT_SOCKET";

/**
 * The argument the bridge starts the app with when an agent needs it and it
 * isn't running: no window and no Dock icon, just the socket, until the
 * person opens ClipCat themselves. It quits when the last agent leaves.
 */
export const BACKGROUND_ARG = "--mcp-background";

export type ServerEntry = Record<string, string | string[] | boolean | Record<string, string>>;

/** How a config file spells its server map: JSON under `mcpServers` (or VS Code's `servers`), or Codex's TOML tables. */
export type ConfigFormat = "mcpServers" | "servers" | "toml";

/**
 * A path under one of the two per-user roots. `appData` is where desktop apps
 * keep their files (~/Library/Application Support on macOS, %APPDATA% on
 * Windows); install.ts knows where the roots are.
 */
export type AgentPath = { root: "home" | "appData"; path: string };

export type AgentTarget = {
  id: AgentId;
  label: string;
  /** Path whose presence means the agent is set up on this computer. */
  marker: AgentPath;
  /** The config file our entry goes into. */
  config: AgentPath;
  format: ConfigFormat;
  entry(spec: McpServerSpec): ServerEntry;
};

const stdio = (extra: ServerEntry) => (spec: McpServerSpec): ServerEntry => ({ ...extra, command: spec.command, args: [...spec.args], env: { ...spec.env } });

// Claude Code's user scope is the top-level `mcpServers` of ~/.claude.json,
// the same place `claude mcp add --scope user` writes. Claude Desktop's file
// takes stdio servers without a type. Codex reads ~/.codex/config.toml.
// Cursor, Windsurf, LM Studio and Gemini CLI each keep one user-wide JSON
// file with the same `mcpServers` map; VS Code's user mcp.json calls it
// `servers` and wants the type.
export const AGENT_TARGETS: readonly AgentTarget[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    marker: { root: "home", path: ".claude" },
    config: { root: "home", path: ".claude.json" },
    format: "mcpServers",
    entry: stdio({ type: "stdio" }),
  },
  {
    id: "codex",
    label: "Codex",
    marker: { root: "home", path: ".codex" },
    config: { root: "home", path: ".codex/config.toml" },
    format: "toml",
    entry: stdio({}),
  },
  {
    id: "claude-desktop",
    label: "Claude desktop app",
    marker: { root: "appData", path: "Claude" },
    config: { root: "appData", path: "Claude/claude_desktop_config.json" },
    format: "mcpServers",
    entry: stdio({}),
  },
  {
    id: "cursor",
    label: "Cursor",
    marker: { root: "home", path: ".cursor" },
    config: { root: "home", path: ".cursor/mcp.json" },
    format: "mcpServers",
    entry: stdio({ type: "stdio" }),
  },
  {
    id: "vscode",
    label: "VS Code",
    marker: { root: "appData", path: "Code/User" },
    config: { root: "appData", path: "Code/User/mcp.json" },
    format: "servers",
    entry: stdio({ type: "stdio" }),
  },
  {
    id: "windsurf",
    label: "Windsurf",
    marker: { root: "home", path: ".codeium/windsurf" },
    config: { root: "home", path: ".codeium/windsurf/mcp_config.json" },
    format: "mcpServers",
    entry: stdio({}),
  },
  {
    id: "lm-studio",
    label: "LM Studio",
    marker: { root: "home", path: ".lmstudio" },
    config: { root: "home", path: ".lmstudio/mcp.json" },
    format: "mcpServers",
    entry: stdio({}),
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    marker: { root: "home", path: ".gemini" },
    config: { root: "home", path: ".gemini/settings.json" },
    format: "mcpServers",
    entry: stdio({}),
  },
];

export function agentTarget(id: AgentId): AgentTarget {
  const target = AGENT_TARGETS.find((t) => t.id === id);
  if (!target) throw new Error(`Unknown agent: ${id}`);
  return target;
}

/**
 * The config with our entry set, everything else as it was. `text` is the
 * file's content, or null when there is none yet. Throws when the file can't
 * be parsed: a config we can't read is not one we should overwrite.
 */
export function upsertServer(text: string | null, format: ConfigFormat, entry: ServerEntry): string {
  return format === "toml" ? upsertToml(text, entry) : upsertJson(text, format, entry);
}

/** Our entry as `upsertServer` writes it into a file of `format`, for showing before it's written. */
export function previewEntry(format: ConfigFormat, entry: ServerEntry): string {
  if (format === "toml") return tomlTable(entry).trimEnd();
  return JSON.stringify({ [format]: { [SERVER_NAME]: entry } }, null, 2);
}

/** The config with our entry taken out; null when it has none (or can't be parsed), so there is nothing to write. */
export function removeServer(text: string | null, format: ConfigFormat): string | null {
  if (readServer(text, format) === null) return null;
  return format === "toml" ? removeToml(text as string) : removeJson(text as string, format);
}

/** Our entry as the file has it; null when there is none. */
export type Registered = { command: string; args: string[]; env: Record<string, string> };

export function readServer(text: string | null, format: ConfigFormat): Registered | null {
  if (text === null) return null;
  const entry = format === "toml" ? readToml(text) : readJson(text, format);
  if (!entry || typeof entry.command !== "string") return null;
  const args = Array.isArray(entry.args) ? entry.args.filter((a): a is string => typeof a === "string") : [];
  const env: Record<string, string> = {};
  if (typeof entry.env === "object" && entry.env !== null) {
    for (const [k, v] of Object.entries(entry.env)) if (typeof v === "string") env[k] = v;
  }
  return { command: entry.command, args, env };
}

/** Whether an entry under our name is one ClipCat wrote, rather than something the user put there by hand. */
export const isOurs = (registered: Registered): boolean => SOCKET_ENV in registered.env;

/** Whether an entry already runs what `spec` would write. */
export function sameSpec(registered: Registered, spec: McpServerSpec): boolean {
  const keys = Object.keys(spec.env);
  return (
    registered.command === spec.command &&
    registered.args.length === spec.args.length &&
    registered.args.every((a, i) => a === spec.args[i]) &&
    Object.keys(registered.env).length === keys.length &&
    keys.every((k) => registered.env[k] === spec.env[k])
  );
}

// --- JSON ------------------------------------------------------------------

type JsonConfig = Record<string, unknown>;
type JsonKey = Exclude<ConfigFormat, "toml">;

function parseJson(text: string | null): JsonConfig {
  if (text === null || text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    // VS Code and Gemini CLI accept comments and trailing commas, which plain
    // JSON doesn't; rewriting the file would drop them, so it's left alone.
    throw new Error(`${(e as Error).message}. If the file has comments or trailing commas, add ClipCat's entry by hand instead`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("expected a JSON object at the top level");
  return parsed as JsonConfig;
}

function serverMap(config: JsonConfig, key: JsonKey): Record<string, unknown> {
  const servers = config[key];
  return typeof servers === "object" && servers !== null && !Array.isArray(servers) ? (servers as Record<string, unknown>) : {};
}

function upsertJson(text: string | null, key: JsonKey, entry: ServerEntry): string {
  const config = parseJson(text);
  config[key] = { ...serverMap(config, key), [SERVER_NAME]: entry };
  return `${JSON.stringify(config, null, 2)}\n`;
}

function removeJson(text: string, key: JsonKey): string {
  const config = parseJson(text);
  const { [SERVER_NAME]: _ours, ...servers } = serverMap(config, key);
  config[key] = servers;
  return `${JSON.stringify(config, null, 2)}\n`;
}

function readJson(text: string, key: JsonKey): Record<string, unknown> | null {
  let config: JsonConfig;
  try {
    config = parseJson(text);
  } catch {
    return null;
  }
  const entry = serverMap(config, key)[SERVER_NAME];
  return typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : null;
}

// --- TOML (Codex) ----------------------------------------------------------

// Our table and any of its sub-tables (`[mcp_servers.clipcat.env]`, written
// by hand or by `codex mcp add`), each from its header up to the next header
// or the end. A header is `[...]` at column 0.
const TOML_TABLE = new RegExp(String.raw`^\[mcp_servers\.${SERVER_NAME}(?:\.[^\]\n]*)?\][^\n]*\n?(?:(?!\[)[^\n]*\n?)*`, "gm");
const TOML_MAIN = new RegExp(String.raw`^\[mcp_servers\.${SERVER_NAME}\][^\n]*\n?(?:(?!\[)[^\n]*\n?)*`, "m");
const TOML_ENV = new RegExp(String.raw`^\[mcp_servers\.${SERVER_NAME}\.env\][^\n]*\n?((?:(?!\[)[^\n]*\n?)*)`, "m");

const tomlString = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const tomlKey = (key: string) => (/^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key));

function tomlValue(value: ServerEntry[string]): string {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string") return tomlString(value);
  if (Array.isArray(value)) return `[${value.map(tomlString).join(", ")}]`;
  return `{ ${Object.entries(value).map(([k, v]) => `${tomlKey(k)} = ${tomlString(v)}`).join(", ")} }`;
}

function tomlTable(entry: ServerEntry): string {
  const lines = Object.entries(entry).map(([key, value]) => `${key} = ${tomlValue(value)}`);
  return [`[mcp_servers.${SERVER_NAME}]`, ...lines, ""].join("\n");
}

/** Drops our tables, then the blank lines they sat between, so a connect/disconnect cycle leaves no growing gap. */
function withoutOurs(text: string): string {
  const rest = text.replace(TOML_TABLE, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  return rest === "" ? "" : `${rest}\n`;
}

function upsertToml(text: string | null, entry: ServerEntry): string {
  const current = text ?? "";
  const table = tomlTable(entry);
  // Our table goes back where it was, so the user's ordering survives.
  const at = current.search(TOML_MAIN);
  if (at >= 0) {
    const before = withoutOurs(current.slice(0, at));
    const after = withoutOurs(current.slice(at));
    return `${before}${before ? "\n" : ""}${table}${after ? `\n${after}` : ""}`;
  }
  const separator = current === "" || current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  return `${current}${separator}${table}`;
}

const removeToml = withoutOurs;

const untomlString = (value: string) => value.replace(/\\(["\\])/g, "$1");

/** `key = "value"` pairs, from an inline table's body or a table's lines. */
function stringPairs(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(?:^|[,{\n])\s*("(?:[^"\\]|\\.)*"|[A-Za-z0-9_-]+)\s*=\s*"((?:[^"\\]|\\.)*)"/g)) {
    const key = m[1]!.startsWith('"') ? untomlString(m[1]!.slice(1, -1)) : m[1]!;
    out[key] = untomlString(m[2]!);
  }
  return out;
}

function readToml(text: string): Record<string, unknown> | null {
  const table = text.match(TOML_MAIN)?.[0];
  if (!table) return null;
  const entry: Record<string, unknown> = {};
  for (const line of table.split("\n").slice(1)) {
    const scalar = line.match(/^(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/);
    if (scalar) {
      entry[scalar[1]!] = untomlString(scalar[2]!);
      continue;
    }
    const list = line.match(/^(\w+)\s*=\s*\[([^\]]*)\]\s*$/);
    if (list) {
      entry[list[1]!] = [...list[2]!.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => untomlString(m[1]!));
      continue;
    }
    const inline = line.match(/^(\w+)\s*=\s*\{(.*)\}\s*$/);
    if (inline) entry[inline[1]!] = stringPairs(inline[2]!);
  }
  const envTable = text.match(TOML_ENV)?.[1];
  if (envTable !== undefined) entry.env = { ...(entry.env as Record<string, string> | undefined), ...stringPairs(envTable) };
  return entry;
}
