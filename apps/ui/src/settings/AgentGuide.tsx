import type { McpAgentIdValue, McpAgentValue } from "@clipcat/ipc";
import { BookOpen, Check, Copy } from "lucide-react";
import { useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";

/** The longer version of this guide, on the site; in the app, the link opens the same page in the Help window. */
export const GUIDE_URL = "https://clipcat.followusai.com/docs/agents";

/** How to get from Connect to a first edit, per agent: restart it, check ClipCat is there, ask. */
const STEPS: Record<McpAgentIdValue, { label: string; steps: string[] }> = {
  "claude-desktop": {
    label: "Claude desktop app",
    steps: [
      "Choose Connect next to the Claude desktop app above, check the entry ClipCat shows you, then choose Add to Claude desktop app.",
      "Quit Claude completely and open it again. Closing the window isn't enough: it only looks for tools when it starts.",
      "Check it's there: the Claude desktop app's row above says Connected now once Claude has started ClipCat. In Claude, `Settings > Developer` lists clipcat as running too.",
      "Ask for something and say ClipCat, like \"List my ClipCat projects\". Claude asks before it uses a ClipCat tool for the first time. Choose Allow.",
    ],
  },
  "claude-code": {
    label: "Claude Code",
    steps: [
      "Choose Connect next to Claude Code above, then Add to Claude Code. ClipCat is added for every folder you work in, not just one, and ClipCat checks with Claude Code that it connects.",
      "Start a new Claude Code session. One that was already running won't see ClipCat.",
      "Type `/mcp`. clipcat should be in the list as connected, and Claude Code's row above says Connected now.",
      "Ask for something and say ClipCat, like \"List my ClipCat projects\". Approve each tool the first time Claude Code asks.",
    ],
  },
  codex: {
    label: "Codex",
    steps: [
      "Choose Connect next to Codex above, then Add to Codex. The Codex CLI, the Codex app and the editor extension all read the same settings file, so this covers each of them.",
      "Start a new Codex session, or quit the Codex app and open it again.",
      "In the CLI, type `/mcp`. clipcat should be in the list with its tools. Once Codex starts ClipCat, Codex's row above says Connected now.",
      "Ask for something and say ClipCat, like \"List my ClipCat projects\".",
    ],
  },
  cursor: {
    label: "Cursor",
    steps: [
      "Choose Connect next to Cursor above, then Add to Cursor. ClipCat goes in `~/.cursor/mcp.json`, so every project you open in Cursor has it.",
      "Open a new Cursor window, or quit Cursor and open it again.",
      "Check it's there: in `Cursor Settings > MCP`, clipcat is listed and turned on, with its tools. Once the agent starts ClipCat, Cursor's row above says Connected now.",
      "In the agent chat, ask for something and say ClipCat, like \"List my ClipCat projects\". Approve each tool when Cursor asks.",
    ],
  },
  vscode: {
    label: "VS Code",
    steps: [
      "Choose Connect next to VS Code above, then Add to VS Code. ClipCat goes in your user `mcp.json`, so every workspace has it.",
      "Open a new VS Code window. If clipcat doesn't start on its own, run `MCP: List Servers` from the Command Palette, pick clipcat and choose Start.",
      "Open Copilot Chat, switch it to Agent mode, and check clipcat's tools are ticked under the tools button. VS Code's row above says Connected now once it starts ClipCat.",
      "Ask for something and say ClipCat, like \"List my ClipCat projects\". Choose Allow when VS Code asks to run a ClipCat tool.",
    ],
  },
  windsurf: {
    label: "Windsurf",
    steps: [
      "Choose Connect next to Windsurf above, then Add to Windsurf. ClipCat goes in `~/.codeium/windsurf/mcp_config.json`.",
      "Restart Windsurf, or open Cascade's MCP servers and choose Refresh.",
      "Check it's there: Cascade's MCP list shows clipcat with its tools, and Windsurf's row above says Connected now.",
      "Ask Cascade for something and say ClipCat, like \"List my ClipCat projects\".",
    ],
  },
  "lm-studio": {
    label: "LM Studio",
    steps: [
      "Choose Connect next to LM Studio above, then Add to LM Studio. ClipCat goes in `~/.lmstudio/mcp.json`.",
      "Quit LM Studio and open it again, then load a model that can use tools.",
      "In a chat, open the integrations menu and turn on `mcp/clipcat`. LM Studio's row above says Connected now once it starts ClipCat.",
      "Ask for something and say ClipCat, like \"List my ClipCat projects\". LM Studio asks before each tool runs. Small local models can miss steps, so check what it did in ClipCat.",
    ],
  },
  gemini: {
    label: "Gemini CLI",
    steps: [
      "Choose Connect next to Gemini CLI above, then Add to Gemini CLI. ClipCat goes in `~/.gemini/settings.json`, for every folder you work in.",
      "Start a new `gemini` session. One that was already running won't see ClipCat.",
      "Type `/mcp`. clipcat should be listed as ready, with its tools, and Gemini CLI's row above says Connected now.",
      "Ask for something and say ClipCat, like \"List my ClipCat projects\". Approve each tool the first time Gemini CLI asks.",
    ],
  },
};

/** A step's text, with `command` spans set as code. */
function StepText({ text }: { text: string }) {
  return <>{text.split(/`([^`]+)`/).map((part, i) => (i % 2 ? <code key={i} className="guide__code">{part}</code> : part))}</>;
}

const ORDER: McpAgentIdValue[] = ["claude-desktop", "claude-code", "codex", "cursor", "vscode", "windsurf", "lm-studio", "gemini"];

/** Things to ask, each one doable with ClipCat's tools as they are. */
export const PROMPTS = [
  "List my ClipCat projects and tell me which ones haven't been exported yet.",
  "In ClipCat, cut the filler words and long pauses from my newest project. Show me what you'll cut before you do it.",
  "Ask ClipCat's AI editor for cuts on my newest project, then accept the retakes and leave the rest for me.",
  "In my newest ClipCat project, cut the part where I talk about pricing.",
  "Add a zoom on each line where I give a number, and a whoosh where each new topic starts.",
  "Make three ClipCat shorts of up to 60 seconds from my newest project.",
  "Write the chapters and a YouTube description for my newest ClipCat project.",
  "Import ~/Movies/take-1.mov and ~/Movies/take-2.mov into a new ClipCat project, and cut the retakes once it's transcribed.",
  "Export my newest ClipCat project as a 9:16 video to my Desktop, and save a Final Cut Pro timeline beside it.",
];

/** The tab to open on: the first connected agent, or the Claude app when none is. */
function firstTab(agents: McpAgentValue[] | null): McpAgentIdValue {
  return ORDER.find((id) => agents?.some((a) => a.id === id && a.connected)) ?? ORDER[0]!;
}

/**
 * What connecting an agent gets you and how to start: per-agent steps from
 * Connect to a first edit, prompts to copy, and what to do when the agent
 * can't find ClipCat.
 */
export function AgentGuide({ agents }: { agents: McpAgentValue[] | null }) {
  const [picked, setPicked] = useState<McpAgentIdValue | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const tab = picked ?? firstTab(agents);

  const copy = (prompt: string) => {
    void navigator.clipboard.writeText(prompt).then(() => setCopied(prompt));
  };

  return (
    <section className="settings__group guide" aria-labelledby="guide-title">
      <h3 id="guide-title" className="settings__label">
        How to use it
      </h3>
      <p className="settings__body">
        Connecting adds a ClipCat entry to the agent's own settings file. There's no account to sign in to: the agent runs a small ClipCat helper on
        this computer and talks to this window through it, and nothing goes over the internet. Keep ClipCat open while you work, and you'll see each
        change land in the editor.
      </p>
      <label className="field guide__pick">
        <span className="field__label">Steps for</span>
        <select className="field__control" value={tab} onChange={(e) => setPicked(e.target.value as McpAgentIdValue)}>
          {ORDER.map((id) => (
            <option key={id} value={id}>
              {STEPS[id].label}
              {agents?.some((a) => a.id === id && a.connected) ? " (connected)" : ""}
            </option>
          ))}
        </select>
      </label>
      <ol className="guide__steps" aria-label={`Steps for ${STEPS[tab].label}`}>
        {STEPS[tab].steps.map((step) => (
          <li key={step}>
            <span>
              <StepText text={step} />
            </span>
          </li>
        ))}
      </ol>
      <h3 className="guide__subtitle">Things to ask</h3>
      <p className="settings__hint">Say "ClipCat" or "my ClipCat project" so the agent knows to use it. It reads the transcript before it changes anything.</p>
      <ul className="guide__prompts" aria-label="Example prompts">
        {PROMPTS.map((prompt) => (
          <li key={prompt} className="guide__prompt">
            <span className="guide__prompt-text">{prompt}</span>
            <button type="button" className="button button--icon" aria-label={copied === prompt ? "Copied" : "Copy prompt"} title="Copy" onClick={() => copy(prompt)}>
              {copied === prompt ? (
                <Check className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              ) : (
                <Copy className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              )}
            </button>
          </li>
        ))}
      </ul>
      <details className="guide__more">
        <summary>What the agent can do</summary>
        <ul className="guide__list">
          <li>Read your projects, their transcripts, the edits ClipCat's AI editor suggested, and what ClipCat is working on.</li>
          <li>Cut and restore words, and accept or reject suggested edits.</li>
          <li>Add zooms, b-roll from the project's media, motion slides, sound effects and chapters, fix misheard words, and change the captions, speed, aspect ratio and music volume.</li>
          <li>Start the jobs you'd start here: importing recordings, AI cuts, shorts, the write-up, video exports and Final Cut, Premiere or EDL timelines.</li>
          <li>Every change is one undo step, just like an edit you make yourself. Nothing deletes your footage.</li>
        </ul>
      </details>
      <details className="guide__more">
        <summary>If it doesn't work</summary>
        <ul className="guide__list">
          <li>The agent doesn't know about ClipCat: quit it completely and open it again, then check its list of tools (step 3).</li>
          <li>It says it can't reach ClipCat: open ClipCat and ask again.</li>
          <li>A change is refused because the project changed: you or the agent edited it in between. Ask it to read the project again and retry.</li>
          <li>A job like AI cuts or shorts fails: those run on the AI you picked in ClipCat, so check that one is signed in.</li>
          <li>VS Code or Gemini CLI won't take the entry because its file has comments in it: copy the setup from Set up another MCP app above and paste it in yourself.</li>
          <li>Still stuck: choose Test next to the agent above to see which step fails, disconnect and connect again, or save diagnostics from the Troubleshooting page and attach them to an issue.</li>
        </ul>
      </details>
      <a
        className="guide__link"
        href={GUIDE_URL}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          const api = bridge();
          if (!api) return;
          e.preventDefault();
          void api.invoke("help:open", { page: "agents" });
        }}
      >
        Read the full guide
        <BookOpen className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
      </a>
    </section>
  );
}
