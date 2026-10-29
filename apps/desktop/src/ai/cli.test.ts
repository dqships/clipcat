import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { brewPackage, cliStatus, codexWarning, installCommand, installFor, installSource, lastLine, latestVersion, runCli, updateCommand } from "./cli";
import type { HostEnv } from "./env";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clipcat-cli-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Only `dir/bin` on PATH, with nothing from the real computer. */
const host = (): HostEnv => ({ env: { PATH: join(dir, "bin"), HOME: dir, CODEX_HOME: join(dir, ".codex") }, extraDirs: [] });

/** A stand-in CLI that prints `version`, and logs any other call. */
async function fake(name: string, version: string, folder = join(dir, "bin")) {
  await mkdir(folder, { recursive: true });
  const path = join(folder, name);
  await writeFile(
    path,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi
echo "$0 $*" >> "${join(dir, "calls.log")}"
echo "Downloading..."
echo "Done"
`,
  );
  await chmod(path, 0o755);
  return path;
}

describe("installSource", () => {
  it("tells the installers apart by where the copy lives", () => {
    expect(installSource("claude", "/Users/me/.local/bin/claude", "/Users/me/.local/share/claude/versions/2.1.312")).toBe("native");
    expect(installSource("claude", "/opt/homebrew/bin/claude", "/opt/homebrew/Caskroom/claude-code/2.1.308/claude")).toBe("brew");
    expect(installSource("claude", "C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd", "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe")).toBe("npm");
    expect(installSource("claude", "C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe")).toBe("winget");
    expect(installSource("codex", "/opt/homebrew/bin/codex", "/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js")).toBe("npm");
    expect(installSource("codex", "/Users/me/.bun/bin/codex", "/Users/me/.bun/install/global/node_modules/@openai/codex/bin/codex.js")).toBe("bun");
    expect(installSource("codex", "/Users/me/.local/bin/codex", "/Users/me/.codex/packages/standalone/current/bin/codex")).toBe("native");
    expect(installSource("codex", "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex")).toBe("app");
    expect(installSource("codex", "/usr/bin/codex")).toBe("unknown");
  });

  it("names the Homebrew cask a copy came from", () => {
    expect(brewPackage("/opt/homebrew/Caskroom/claude-code@latest/2.1.312/claude")).toEqual({ cask: true, name: "claude-code@latest" });
    expect(brewPackage("/usr/local/Cellar/codex/0.165.0/bin/codex")).toEqual({ cask: false, name: "codex" });
    expect(brewPackage("/Users/me/.local/bin/claude")).toBeNull();
  });
});

describe("commands", () => {
  it("installs with each maker's own script", () => {
    expect(installCommand("claude", "darwin")).toMatchObject({ file: "/bin/bash", args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"] });
    expect(installCommand("codex", "darwin")).toMatchObject({ args: ["-c", "curl -fsSL https://chatgpt.com/codex/install.sh | sh"], env: { CODEX_NON_INTERACTIVE: "1" } });
    expect(installCommand("claude", "win32")).toMatchObject({ file: "powershell.exe", display: "irm https://claude.ai/install.ps1 | iex" });
    expect(installCommand("codex", "win32").args.at(-1)).toBe("irm https://chatgpt.com/codex/install.ps1 | iex");
  });

  it("installs Gemini CLI with npm, else Homebrew, else says it needs Node.js", async () => {
    expect(installFor("gemini", host(), "darwin")).toEqual({ manual: expect.stringMatching(/Node\.js/) });
    const brew = await fake("brew", "5.0.0");
    expect(installFor("gemini", host(), "darwin")).toEqual({ command: { file: brew, args: ["install", "gemini-cli"], display: "brew install gemini-cli" } });
    expect(installFor("gemini", host(), "win32")).toHaveProperty("manual");
    const npm = await fake("npm", "11.0.0");
    expect(installFor("gemini", host(), "darwin")).toEqual({ command: { file: npm, args: ["install", "-g", "@google/gemini-cli"], display: "npm install -g @google/gemini-cli" } });
    expect(installFor("codex", host(), "darwin")).toEqual({ command: installCommand("codex", "darwin") });
  });

  it("shows no button for Gemini CLI when there's nothing to install it with", async () => {
    const status = await cliStatus("gemini", { host: host(), latest: async () => "0.14.0", platform: "darwin" });
    expect(status).toMatchObject({ label: "Gemini CLI", path: null, action: null, command: null, manual: expect.stringMatching(/Node\.js/) });
    await fake("npm", "11.0.0");
    expect(await cliStatus("gemini", { host: host(), latest: async () => "0.14.0", platform: "darwin" })).toMatchObject({ action: "install", command: "npm install -g @google/gemini-cli" });
  });

  it("updates through whatever installed the copy", async () => {
    const npm = await fake("npm", "11.0.0");
    const brew = await fake("brew", "5.0.0");
    const h = host();
    expect(updateCommand("claude", "/Users/me/.local/bin/claude", "/Users/me/.local/share/claude/versions/2", h)).toMatchObject({ command: { args: ["update"], display: "claude update" } });
    expect(updateCommand("codex", join(dir, "bin", "codex"), "/x/lib/node_modules/@openai/codex/bin/codex.js", h)).toEqual({
      command: { file: npm, args: ["install", "-g", "@openai/codex@latest"], display: "npm install -g @openai/codex@latest" },
    });
    expect(updateCommand("claude", "/opt/homebrew/bin/claude", "/opt/homebrew/Caskroom/claude-code/2.1.308/claude", h)).toEqual({
      command: { file: brew, args: ["upgrade", "--cask", "claude-code"], display: "brew upgrade --cask claude-code" },
    });
    expect(updateCommand("codex", "/Users/me/.local/bin/codex", "/Users/me/.codex/packages/standalone/current/bin/codex", h, "darwin")).toMatchObject({
      command: { display: "curl -fsSL https://chatgpt.com/codex/install.sh | sh" },
    });
  });

  it("says what to do when ClipCat can't update a copy itself", () => {
    expect(updateCommand("codex", "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex", "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex", host())).toEqual({
      manual: "This Codex came with an app. Update the app to update it.",
    });
    expect(updateCommand("codex", "/usr/bin/codex", "/usr/bin/codex", host())).toMatchObject({ manual: expect.stringContaining("the way you installed it") });
  });
});

describe("latestVersion", () => {
  const registry = (tags: Record<string, string>) => (async () => new Response(JSON.stringify(tags))) as unknown as typeof fetch;

  it("reads the channel's dist-tag", async () => {
    expect(await latestVersion("claude", "stable", registry({ stable: "2.1.308", latest: "2.1.312" }))).toBe("2.1.308");
    expect(await latestVersion("codex", "latest", registry({ latest: "0.165.0", alpha: "0.166.0-alpha.5" }))).toBe("0.165.0");
  });

  it("is null when the registry can't be reached", async () => {
    const offline = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await latestVersion("claude", "latest", offline)).toBeNull();
  });
});

describe("codexWarning", () => {
  const app = { path: "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex", version: "0.164.0" };

  it("warns when another Codex sharing config.toml is newer", () => {
    const text = codexWarning({ path: "/Users/me/.local/bin/codex", version: "0.157.1" }, [app], "gpt-6.1-sol", app.path);
    expect(text).toBe(
      "Your codex command is 0.157.1, older than the ChatGPT app's Codex (0.164.0), and both read ~/.codex/config.toml. It sets the model to gpt-6.1-sol, which Codex 0.157.1 may not know. ClipCat runs the newer copy, so editing works; update this one for your terminal.",
    );
  });

  it("stays quiet when this copy is the newest", () => {
    expect(codexWarning({ path: "/Users/me/.local/bin/codex", version: "0.165.0" }, [app], "gpt-6.1-sol", null)).toBeNull();
    expect(codexWarning({ path: "/Users/me/.local/bin/codex", version: "0.157.1" }, [], "gpt-6.1-sol", null)).toBeNull();
  });
});

describe("lastLine", () => {
  it("drops colour codes and progress redraws", () => {
    expect(lastLine("\u001b[32m✔\u001b[0m Installing\r 45%\r 90%\n")).toBe("90%");
    expect(lastLine("Installed Codex 0.165.0\n\n")).toBe("Installed Codex 0.165.0");
    expect(lastLine("\n----\n")).toBeNull();
  });
});

describe.skipIf(process.platform === "win32")("cliStatus and runCli", () => {
  const latest = (version: string) => async () => version;

  it("offers the installer when the CLI is missing", async () => {
    const status = await cliStatus("claude", { host: host(), latest: latest("2.1.312"), platform: "darwin" });
    expect(status).toMatchObject({ path: null, action: "install", command: "curl -fsSL https://claude.ai/install.sh | bash", latest: "2.1.312" });
  });

  it("offers an update when a newer release is out, and nothing when it's current", async () => {
    await fake("claude", "2.1.300 (Claude Code)");
    expect(await cliStatus("claude", { host: host(), latest: latest("2.1.312") })).toMatchObject({ version: "2.1.300", action: "update", command: "claude update" });
    expect(await cliStatus("claude", { host: host(), latest: latest("2.1.300") })).toMatchObject({ action: null, command: null });
  });

  it("warns about a Codex older than the one sharing its config", async () => {
    const mine = await fake("codex", "codex-cli 0.157.1");
    const newer = await fake("codex", "codex-cli 0.164.0", join(dir, "other"));
    await mkdir(join(dir, ".codex"), { recursive: true });
    await writeFile(join(dir, ".codex", "config.toml"), 'model = "gpt-6.1-sol"\n');
    const h = { ...host(), extraDirs: [join(dir, "other")] };
    const status = await cliStatus("codex", { host: h, latest: latest("0.165.0"), codexRuns: async () => newer });
    expect(status.path).toBe(mine);
    expect(status.warning).toContain(`older than the Codex at ${newer} (0.164.0)`);
    expect(status.warning).toContain("gpt-6.1-sol");
    expect(status.manual).toMatch(/the way you installed it/);
  });

  it("runs the update and reports the new version", async () => {
    // A Claude Code whose `update` swaps its own version, as the real one does. PATH holds only the fakes, so shell builtins only.
    await mkdir(join(dir, "bin"), { recursive: true });
    const path = join(dir, "bin", "claude");
    const state = join(dir, "version");
    await writeFile(state, "2.1.300");
    await writeFile(
      path,
      `#!/bin/sh
if [ "$1" = "--version" ]; then read -r v < "${state}"; echo "$v (Claude Code)"; exit 0; fi
if [ "$1" = "update" ]; then echo "Checking for updates"; echo "2.1.312" > "${state}"; echo "Successfully updated"; exit 0; fi
exit 2
`,
    );
    await chmod(path, 0o755);
    const lines: string[] = [];
    const after = await runCli("claude", { host: host(), latest: latest("2.1.312") }, (line) => lines.push(line));
    expect(after).toMatchObject({ version: "2.1.312", action: null });
    expect(lines[0]).toBe("Running claude update");
    expect(lines).toContain("Successfully updated");
  });

  it("rejects with the installer's last lines when it fails", async () => {
    await mkdir(join(dir, "bin"), { recursive: true });
    const real = join(dir, "lib", "node_modules", "@openai", "codex", "bin");
    await mkdir(real, { recursive: true });
    await writeFile(join(real, "codex.js"), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 0.150.0"; fi\n');
    await chmod(join(real, "codex.js"), 0o755);
    await symlink(join(real, "codex.js"), join(dir, "bin", "codex"));
    await writeFile(join(dir, "bin", "npm"), "#!/bin/sh\necho 'npm error code EACCES' >&2\nexit 243\n");
    await chmod(join(dir, "bin", "npm"), 0o755);
    await expect(runCli("codex", { host: host(), latest: latest("0.165.0") }, () => {})).rejects.toThrow(
      "npm install -g @openai/codex@latest failed (exit 243): npm error code EACCES",
    );
  });
});
