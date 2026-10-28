// Claude Code through the Agent SDK, using the user's own signed-in `claude`.
// Each task is one short query with no built-in tools at all: the only
// thing the agent can do is call ClipCat's submit tool, which runs here
// in-process, so there is no port to open and nothing on disk it can touch.
// Finding and checking the CLI follows Diffusion Studio's editor
// (packages/agent-chat/src/host/claude.ts).

import { readFile } from "node:fs/promises";
import { type SDKUserMessage, createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { Agent, AgentRun } from "./analyze";
import { type HostEnv, compareVersions, parseVersion, resolveBinary, resolveClaudeExecutable, runOnce } from "./env";

const MIN_VERSION = "2.0.0";
const SERVER = "clipcat";
/** Long enough for an answer, a corrected one, and a slide's look at its stills. */
const MAX_TURNS = 8;

export const SIGN_IN_HINT = "Run `claude auth login` in a terminal, then try again.";

export type AgentStatus = {
  status: "ready" | "not-installed" | "signed-out" | "outdated";
  version: string | null;
  detail: string | null;
};

/** What the CLI says when it has no usable login, the expired-OAuth message among them. */
export function isAuthFailure(text: string): boolean {
  return /failed to authenticate|oauth|not (?:logged|signed) in|log ?in|unauthori[sz]ed|authentication/i.test(text);
}

/** `claude auth status` prints `{ "loggedIn": false, … }`; null when it can't say. */
export function parseLoggedIn(output: string | null): boolean | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output.slice(output.indexOf("{"))) as { loggedIn?: unknown };
    return typeof parsed.loggedIn === "boolean" ? parsed.loggedIn : null;
  } catch {
    const match = /"loggedIn"\s*:\s*(true|false)/.exec(output);
    return match ? match[1] === "true" : null;
  }
}

export async function probeClaude(host: HostEnv): Promise<AgentStatus> {
  const binary = resolveBinary("claude", host);
  if (!binary) return { status: "not-installed", version: null, detail: "Install Claude Code, then reopen ClipCat." };
  const version = parseVersion(await runOnce(binary, ["--version"], host)) ?? null;
  if (version && compareVersions(version, MIN_VERSION) < 0) {
    return { status: "outdated", version, detail: `Update Claude Code: ${version} is older than ${MIN_VERSION}.` };
  }
  if (parseLoggedIn(await runOnce(binary, ["auth", "status"], host, 8000)) === false) {
    return { status: "signed-out", version, detail: SIGN_IN_HINT };
  }
  return { status: "ready", version, detail: null };
}

/** The prompt as the SDK takes it: plain text, or one message with the pictures before the text. */
export async function claudePrompt(text: string, images: string[] = []): Promise<string | AsyncIterable<SDKUserMessage>> {
  if (images.length === 0) return text;
  const pictures = await Promise.all(
    images.map(async (path) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: "image/jpeg" as const, data: (await readFile(path)).toString("base64") },
    })),
  );
  const message: SDKUserMessage = { type: "user", message: { role: "user", content: [...pictures, { type: "text", text }] }, parent_tool_use_id: null };
  return (async function* () {
    yield message;
  })();
}

export function claudeAgent(host: HostEnv, appVersion: string): Agent {
  return {
    label: "Claude",
    run: async (run: AgentRun) => {
      const binary = resolveBinary("claude", host);
      if (!binary) throw new Error("Claude Code isn't installed. Install it, then reopen ClipCat.");
      let done = false;
      const { task } = run;
      const submit = tool(task.tool, task.description, task.shape, async (args) => {
          run.activity("Checking Claude's answer");
          const reply = await run.submit(args);
          done ||= reply.done;
          const pictures = await Promise.all(
            (reply.images ?? []).map(async (path) => ({ type: "image" as const, data: (await readFile(path)).toString("base64"), mimeType: "image/jpeg" })),
          );
          return { content: [{ type: "text" as const, text: reply.text }, ...pictures], isError: !reply.done && pictures.length === 0 };
        });
      const abort = new AbortController();
      const stop = () => abort.abort();
      run.signal.addEventListener("abort", stop, { once: true });
      let stderr = "";
      try {
        const q = query({
          prompt: await claudePrompt(run.prompt, run.images),
          options: {
            pathToClaudeCodeExecutable: resolveClaudeExecutable(binary),
            systemPrompt: `${run.system}\n\n${task.toolAnswer}`,
            tools: [],
            mcpServers: { [SERVER]: createSdkMcpServer({ name: SERVER, version: appVersion, tools: [submit], alwaysLoad: true }) },
            allowedTools: [`mcp__${SERVER}__${task.tool}`],
            permissionMode: "dontAsk",
            strictMcpConfig: true,
            settingSources: [],
            persistSession: false,
            maxTurns: MAX_TURNS,
            abortController: abort,
            env: { ...host.env, CLAUDE_CODE_AUTO_CONNECT_IDE: "0", CLAUDE_AGENT_SDK_CLIENT_APP: `clipcat/${appVersion}` },
            stderr: (data) => {
              stderr = (stderr + data).slice(-4000);
            },
          },
        });
        run.activity(run.images?.length ? "Claude is looking at your media" : "Claude is reading the transcript");
        for await (const message of q) {
          if (message.type !== "result") continue;
          // Once the analysis is saved, how the turn ended doesn't matter.
          if (done || (message.subtype === "success" && !message.is_error)) return;
          const errors = (message as { errors?: string[] }).errors;
          const text = message.subtype === "success" ? message.result : errors?.join("\n") || message.subtype.replace(/_/g, " ");
          throw new Error(isAuthFailure(text) ? `Claude Code is signed out. ${SIGN_IN_HINT}` : text);
        }
      } catch (e) {
        if (done || run.signal.aborted) return;
        const message = e instanceof Error ? e.message : String(e);
        if (isAuthFailure(message)) throw new Error(`Claude Code is signed out. ${SIGN_IN_HINT}`);
        const detail = stderr.trim().split("\n").at(-1);
        throw new Error(detail && !message.includes(detail) ? `${message}: ${detail}` : message);
      } finally {
        run.signal.removeEventListener("abort", stop);
      }
    },
  };
}
