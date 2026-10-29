// The Claude Code, Codex and Gemini CLI command-line tools themselves: which
// version the user's `claude`, `codex` and `gemini` commands are, the newest
// one out, and
// installing or updating each the way its maker documents. An update goes
// through whatever installed the copy (its own updater, npm, Homebrew,
// WinGet), so ClipCat never leaves a second copy fighting the first on PATH.

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { bundledDirs, codexHome, configModel } from "./codex";
import { type HostEnv, compareVersions, killTree, needsShell, parseVersion, quoteArg, resolveBinary, runOnce, which, whichAll } from "./env";

export type CliId = "claude" | "codex" | "gemini";

/** How a copy got onto the computer, which decides how it updates. */
export type CliSource = "native" | "npm" | "bun" | "brew" | "winget" | "app" | "unknown";

/** One command to run: the program, its arguments, and how it reads typed into a terminal. */
export type CliCommand = { file: string; args: string[]; env?: Record<string, string>; display: string };

export type CliStatus = {
  id: CliId;
  label: string;
  /** The `claude`, `codex` or `gemini` the user's terminal runs; null when there is none. */
  path: string | null;
  version: string | null;
  source: CliSource | null;
  /** The newest release on the copy's channel, or null when it couldn't be checked. */
  latest: string | null;
  /** What the button does: install a missing CLI, update an older one, or nothing. */
  action: "install" | "update" | null;
  /** The command the button runs, as it would be typed in a terminal. */
  command: string | null;
  /** Why ClipCat can't update this copy itself, and what to do instead. */
  manual: string | null;
  /** A problem with this copy beyond being old. */
  warning: string | null;
};

const LABELS: Record<CliId, string> = { claude: "Claude Code", codex: "Codex", gemini: "Gemini CLI" };
const PACKAGES: Record<CliId, string> = { claude: "@anthropic-ai/claude-code", codex: "@openai/codex", gemini: "@google/gemini-cli" };
/** Each CLI's Homebrew formula or cask, for telling the user what to run. */
const BREW: Record<CliId, string> = { claude: "claude-code", codex: "codex", gemini: "gemini-cli" };

/** The official install scripts (code.claude.com/docs/en/setup, github.com/openai/codex). Gemini CLI has none: npm or Homebrew. */
const INSTALLERS: Record<Exclude<CliId, "gemini">, { sh: string; ps: string }> = {
  claude: { sh: "curl -fsSL https://claude.ai/install.sh | bash", ps: "irm https://claude.ai/install.ps1 | iex" },
  codex: { sh: "curl -fsSL https://chatgpt.com/codex/install.sh | sh", ps: "irm https://chatgpt.com/codex/install.ps1 | iex" },
};

/** Long enough for a slow download, short enough that a stuck installer gives up. */
const RUN_TIMEOUT_MS = 10 * 60_000;
const LATEST_TTL_MS = 15 * 60_000;

const slashes = (path: string) => path.replace(/\\/g, "/");

/** What installed the copy at `path` (and the file it links to, `real`). */
export function installSource(id: CliId, path: string, real = path): CliSource {
  const both = `${slashes(path)}\n${slashes(real)}`;
  if (/\.app\/Contents\//.test(both)) return "app";
  if (both.includes(`/node_modules/${PACKAGES[id]}/`)) return /\/\.bun\//.test(both) ? "bun" : "npm";
  if (/\/(Caskroom|Cellar)\//.test(both)) return "brew";
  if (/\/winget\//i.test(both)) return "winget";
  if (id === "claude" && /\/\.local\/share\/claude\/|\/\.claude\/local\/|\/\.local\/bin\/claude(\.exe)?$/m.test(both)) return "native";
  if (id === "codex" && /\/\.codex\/packages\/|\/\.local\/bin\/codex$|\/Programs\/OpenAI\/Codex\//m.test(both)) return "native";
  return "unknown";
}

/** The Homebrew cask or formula a copy came from: "claude-code@latest" from …/Caskroom/claude-code@latest/2.1.3/claude. */
export function brewPackage(real: string): { cask: boolean; name: string } | null {
  const match = /\/(Caskroom|Cellar)\/([^/]+)\//.exec(slashes(real));
  return match ? { cask: match[1] === "Caskroom", name: match[2]! } : null;
}

/** The official installer for this platform. */
export function installCommand(id: Exclude<CliId, "gemini">, platform: NodeJS.Platform = process.platform): CliCommand {
  const { sh, ps } = INSTALLERS[id];
  // Codex's installer asks whether to start Codex when it's done; nobody is there to answer.
  const env = id === "codex" ? { CODEX_NON_INTERACTIVE: "1" } : undefined;
  if (platform === "win32") return { file: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], env, display: ps };
  return { file: "/bin/bash", args: ["-c", sh], env, display: sh };
}

/** A program next to `path` (npm beside an npm-installed codex), else on PATH. */
function sibling(name: string, path: string, host: HostEnv): string | null {
  return which(name, { env: { ...host.env, PATH: dirname(path) }, extraDirs: [] }) ?? which(name, host);
}

export type Update = { command: CliCommand } | { manual: string };

/**
 * How to install a missing CLI. Claude Code and Codex have install scripts;
 * Gemini CLI installs with npm (github.com/google-gemini/gemini-cli), or
 * Homebrew when there's no npm, and needs Node.js when there's neither.
 */
export function installFor(id: CliId, host: HostEnv, platform: NodeJS.Platform = process.platform): Update {
  if (id !== "gemini") return { command: installCommand(id, platform) };
  const npm = which("npm", host);
  const npmArgs = ["install", "-g", PACKAGES.gemini];
  if (npm) return { command: { file: npm, args: npmArgs, display: `npm ${npmArgs.join(" ")}` } };
  const brew = platform === "win32" ? null : which("brew", host);
  if (brew) return { command: { file: brew, args: ["install", BREW.gemini], display: `brew install ${BREW.gemini}` } };
  return { manual: "Gemini CLI installs with npm, which comes with Node.js. Install Node.js 20 or newer from nodejs.org, then reopen ClipCat." };
}

/** How to update the copy at `path`, by what installed it. */
export function updateCommand(id: CliId, path: string, real: string, host: HostEnv, platform: NodeJS.Platform = process.platform): Update {
  const source = installSource(id, path, real);
  const label = LABELS[id];
  switch (source) {
    case "app":
      return { manual: `This ${label} came with an app. Update the app to update it.` };
    case "brew": {
      const brew = which("brew", host);
      const pkg = brewPackage(real);
      if (!brew || !pkg) return { manual: `Update it with Homebrew: brew upgrade ${BREW[id]}.` };
      const args = ["upgrade", ...(pkg.cask ? ["--cask"] : []), pkg.name];
      return { command: { file: brew, args, display: `brew ${args.join(" ")}` } };
    }
    case "winget":
      if (id === "claude") return { command: { file: "winget", args: ["upgrade", "Anthropic.ClaudeCode"], display: "winget upgrade Anthropic.ClaudeCode" } };
      return { manual: "Update it with WinGet." };
    case "npm": {
      // Claude Code's own updater handles npm installs; Codex and Gemini CLI have none.
      if (id === "claude") return { command: { file: path, args: ["update"], display: "claude update" } };
      const npm = sibling("npm", path, host);
      const args = ["install", "-g", `${PACKAGES[id]}@latest`];
      if (!npm) return { manual: `Update it with npm: npm ${args.join(" ")}.` };
      return { command: { file: npm, args, display: `npm ${args.join(" ")}` } };
    }
    case "bun": {
      const bun = sibling("bun", path, host) ?? which("bun", { env: {}, extraDirs: [join(homedir(), ".bun", "bin")] });
      const args = ["add", "-g", `${PACKAGES[id]}@latest`];
      if (!bun) return { manual: `Update it with Bun: bun ${args.join(" ")}.` };
      return { command: { file: bun, args, display: `bun ${args.join(" ")}` } };
    }
    case "native":
      // Codex's installer is also its updater; Claude Code updates itself.
      if (id === "codex") return { command: installCommand(id, platform) };
      if (id === "gemini") return { manual: `ClipCat can't tell how this ${label} was installed, so update it the way you installed it.` };
      return { command: { file: path, args: ["update"], display: "claude update" } };
    default:
      if (id === "claude") return { command: { file: path, args: ["update"], display: "claude update" } };
      return { manual: `ClipCat can't tell how this ${label} was installed, so update it the way you installed it.` };
  }
}

/** Claude Code's release channel: the cask's for Homebrew, else `autoUpdatesChannel` in ~/.claude/settings.json. */
async function claudeChannel(real: string | null, home = homedir()): Promise<"latest" | "stable"> {
  const pkg = real ? brewPackage(real) : null;
  if (pkg) return pkg.name.endsWith("@latest") ? "latest" : "stable";
  try {
    const settings = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8")) as { autoUpdatesChannel?: unknown };
    return settings.autoUpdatesChannel === "stable" ? "stable" : "latest";
  } catch {
    return "latest";
  }
}

const latestCache = new Map<string, { at: number; version: string | null }>();

/** The newest release on a channel, from npm's dist-tags (both CLIs publish there with every release). */
export async function latestVersion(id: CliId, channel: "latest" | "stable" = "latest", fetcher: typeof fetch = fetch): Promise<string | null> {
  const key = `${id}:${channel}`;
  const cached = latestCache.get(key);
  if (cached && Date.now() - cached.at < LATEST_TTL_MS) return cached.version;
  let version: string | null = null;
  try {
    const response = await fetcher(`https://registry.npmjs.org/-/package/${PACKAGES[id]}/dist-tags`, { signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      const tags = (await response.json()) as Record<string, unknown>;
      const tag = tags[channel] ?? tags.latest;
      version = typeof tag === "string" && /^\d+\.\d+\.\d+$/.test(tag) ? tag : null;
    }
  } catch {
    // Offline, or the registry is down: the row just doesn't offer an update.
  }
  // A failed check is retried on the next look rather than held for the TTL.
  if (version) latestCache.set(key, { at: Date.now(), version });
  return version;
}

/** Forgets the newest versions, so the next look asks again. */
export function forgetLatest(): void {
  latestCache.clear();
}

/** A path with the home folder as ~. */
function tildify(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/** What another copy of Codex is, for the warning: the app it came with, or where it is. */
function describeCopy(path: string): string {
  const app = /\/([^/]+)\.app\/Contents\//.exec(slashes(path))?.[1];
  return app ? `the ${app} app's Codex` : `the Codex at ${tildify(path)}`;
}

/**
 * The warning for a `codex` older than another Codex on this computer. They
 * all read ~/.codex/config.toml, and the newer one (often the ChatGPT app's)
 * writes settings there, the default model above all, that an older CLI
 * doesn't know: Codex then refuses to run with "model not supported".
 */
export function codexWarning(
  cli: { path: string; version: string | null },
  others: { path: string; version: string | null }[],
  model: string | null,
  clipcatRuns: string | null,
): string | null {
  if (!cli.version) return null;
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const mine = real(cli.path);
  let newest: { path: string; version: string } | null = null;
  for (const other of others) {
    if (!other.version || real(other.path) === mine) continue;
    if (compareVersions(other.version, cli.version) > 0 && (!newest || compareVersions(other.version, newest.version) > 0)) {
      newest = { path: other.path, version: other.version };
    }
  }
  if (!newest) return null;
  const setting = model ? `It sets the model to ${model}, which Codex ${cli.version} may not know.` : "Settings the newer one saves there may not work in this one.";
  const runs = clipcatRuns && real(clipcatRuns) !== mine ? " ClipCat runs the newer copy, so editing works; update this one for your terminal." : " Update this one so they match.";
  return `Your codex command is ${cli.version}, older than ${describeCopy(newest.path)} (${newest.version}), and both read ~/.codex/config.toml. ${setting}${runs}`;
}

export type CliDeps = {
  host: HostEnv;
  /** The newest release; npm's dist-tags by default. */
  latest?: (id: CliId, channel: "latest" | "stable") => Promise<string | null>;
  /** The Codex ClipCat itself runs (the newest it finds), for the warning. */
  codexRuns?: () => Promise<string | null>;
  platform?: NodeJS.Platform;
};

/** Where one CLI stands, and what its button would do. */
export async function cliStatus(id: CliId, deps: CliDeps): Promise<CliStatus> {
  const { host } = deps;
  const platform = deps.platform ?? process.platform;
  const label = LABELS[id];
  const path = resolveBinary(id, host);
  let real: string | null = null;
  if (path) {
    try {
      real = realpathSync(path);
    } catch {
      real = path;
    }
  }
  const channel = id === "claude" ? await claudeChannel(real) : "latest";
  const [version, latest] = await Promise.all([
    path ? runOnce(path, ["--version"], host).then((out) => parseVersion(out) ?? null) : Promise.resolve(null),
    (deps.latest ?? latestVersion)(id, channel),
  ]);
  const base = { id, label, path, version, latest, warning: null, manual: null };
  if (!path) {
    const install = installFor(id, host, platform);
    if ("manual" in install) return { ...base, source: null, action: null, command: null, manual: install.manual };
    return { ...base, source: null, action: "install", command: install.command.display };
  }

  const source = installSource(id, path, real ?? path);
  let warning: string | null = null;
  if (id === "codex") {
    const others = whichAll("codex", { ...host, extraDirs: [...host.extraDirs, ...bundledDirs()] }).filter((p) => p !== path);
    const [versions, toml, runs] = await Promise.all([
      Promise.all(others.map(async (p) => ({ path: p, version: parseVersion(await runOnce(p, ["--version"], host)) ?? null }))),
      readFile(join(codexHome(host), "config.toml"), "utf8").catch(() => ""),
      deps.codexRuns ? deps.codexRuns() : Promise.resolve(null),
    ]);
    warning = codexWarning({ path, version }, versions, configModel(toml), runs);
  }
  // A copy that can't say its version is broken; reinstalling over it is the fix.
  const behind = !version || (latest !== null && compareVersions(version, latest) < 0);
  if (!behind) return { ...base, source, warning, action: null, command: null };
  const update = updateCommand(id, path, real ?? path, host, platform);
  if ("manual" in update) return { ...base, source, warning, action: null, command: null, manual: update.manual };
  return { ...base, source, warning, action: "update", command: update.command.display };
}

/** The readable last line of an installer's output: no colour codes, no progress-bar redraws. */
export function lastLine(chunk: string): string | null {
  const lines = chunk
    .replace(/\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g, "")
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && /[A-Za-z0-9]/.test(line));
  const last = lines.at(-1);
  return last ? last.slice(0, 200) : null;
}

/**
 * Installs or updates one CLI and resolves with where it stands after.
 * `onLine` gets the installer's latest line as it runs. Rejects with the last
 * lines of its output when it fails.
 */
export async function runCli(id: CliId, deps: CliDeps, onLine: (line: string) => void): Promise<CliStatus> {
  const { host } = deps;
  const platform = deps.platform ?? process.platform;
  const before = await cliStatus(id, deps);
  let command: CliCommand;
  if (!before.path) {
    const install = installFor(id, host, platform);
    if ("manual" in install) throw new Error(install.manual);
    command = install.command;
  } else {
    const update = updateCommand(id, before.path, realOr(before.path), host, platform);
    if ("manual" in update) throw new Error(update.manual);
    command = update.command;
  }
  onLine(`Running ${command.display}`);
  await new Promise<void>((resolve, reject) => {
    const shell = needsShell(command.file);
    const child = spawn(shell ? `"${command.file}"` : command.file, shell ? command.args.map(quoteArg) : command.args, {
      env: { ...host.env, ...command.env, NO_COLOR: "1" },
      // Nothing can answer a prompt, so an installer that asks gets an empty stdin and moves on.
      stdio: ["ignore", "pipe", "pipe"],
      shell,
      windowsHide: true,
    });
    let tail = "";
    const read = (chunk: string) => {
      tail = (tail + chunk).slice(-4000);
      const line = lastLine(chunk);
      if (line) onLine(line);
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    const timer = setTimeout(() => {
      tail += "\nStopped after 10 minutes.";
      void killTree(child);
    }, RUN_TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Couldn't run ${command.display}: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const lines = tail
            .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
        .split(/[\r\n]+/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-3)
        .join(" | ");
      reject(new Error(`${command.display} failed${code === null ? "" : ` (exit ${code})`}${lines ? `: ${lines}` : ""}`));
    });
  });
  forgetLatest();
  return cliStatus(id, deps);
}

function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
