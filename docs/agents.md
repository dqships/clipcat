---
title: Use ClipCat from Claude, Codex, Cursor and more
description: Connect ClipCat to Claude Code, Codex, Claude, Cursor, VS Code, Windsurf, LM Studio or Gemini CLI, check it worked, and let the agent edit while you watch.
order: 15
updated: 2026-10-29
---

# Use ClipCat from your coding agent

ClipCat includes an MCP server. Connect it once, and Claude Code, Codex, the Claude desktop app, Cursor, VS Code, Windsurf, LM Studio or Gemini CLI can open your projects, read the transcripts and make edits. You see each change land in ClipCat, and each one is one undo step.

## How it works

Connecting adds a ClipCat entry to the agent's own settings file. When the agent starts, it runs a small ClipCat helper on your computer, which talks to the open ClipCat app over a private connection only your user account can open. There's no account, no sign-in and no network port, and nothing goes over the internet.

If ClipCat isn't open, the helper starts it in the background, with no window. It becomes the usual app when you open ClipCat, and otherwise quits once the agent disconnects and its jobs finish.

The agent asks before it uses each ClipCat tool, unless you tell it to always allow one. For Codex, Cursor and Windsurf, that follows their own approval settings.

## Connect your agent

1. In ClipCat, open **Settings** (the gear in the library).
2. Under **Edit from your coding agent**, choose **Connect** next to your agent. Agents ClipCat can't find on this computer are listed under **Not found on this computer**, and you can connect them there before you install them. A desktop app has **Get** (the app's name), which opens its maker's download page, and a command-line tool has **Install** (its name).
3. Check the entry ClipCat shows you, then choose **Add to** (the agent's name).

ClipCat writes its entry here:

- **Claude desktop app**: `claude_desktop_config.json` in the Claude app's folder.
- **Claude Code**: `~/.claude.json`, for every folder you work in.
- **Codex**: `~/.codex/config.toml`, which the Codex CLI, the Codex app and the editor extension all read.
- **Cursor**: `~/.cursor/mcp.json`, for every project.
- **VS Code**: your user `mcp.json` (in `Code/User` in VS Code's settings folder), under `servers`, for every workspace.
- **Windsurf**: `~/.codeium/windsurf/mcp_config.json`.
- **LM Studio**: `~/.lmstudio/mcp.json`.
- **Gemini CLI**: `~/.gemini/settings.json`, for every folder you work in.

ClipCat won't rewrite a file it can't read as plain JSON. VS Code and Gemini CLI allow comments in theirs, so if yours has any, add the entry by hand from **Set up another MCP app**.

**Disconnect** takes the entry out again. ClipCat points the entry at its current copy each time it opens, so moving or updating the app doesn't break it.

## Start the agent and check

### Claude desktop app

1. Quit Claude completely and open it again. Closing the window isn't enough: it only looks for tools when it starts.
2. In ClipCat's Settings, the Claude desktop app's row says Connected now. In Claude, Settings > Developer lists clipcat as running.
3. Ask for something and say ClipCat, like "List my ClipCat projects". Choose Allow when Claude asks to use a ClipCat tool.

### Claude Code

1. Start a new Claude Code session. A session that was already running won't see ClipCat.
2. Type `/mcp`. clipcat should be listed as connected, and Claude Code's row in ClipCat's Settings says Connected now.
3. Ask for something and say ClipCat. Approve each tool the first time Claude Code asks.

### Codex

1. Start a new Codex session, or quit the Codex app and open it again.
2. In the CLI, type `/mcp`. clipcat should be listed with its tools.
3. Ask for something and say ClipCat.

### Cursor

1. Open a new Cursor window, or quit Cursor and open it again.
2. In Cursor Settings > MCP, clipcat should be listed and turned on, with its tools.
3. In the agent chat, ask for something and say ClipCat. Approve each tool when Cursor asks.

### VS Code

1. Open a new VS Code window. If clipcat doesn't start on its own, run **MCP: List Servers** from the Command Palette, pick clipcat and choose **Start**.
2. Open Copilot Chat in Agent mode and check clipcat's tools are ticked under the tools button.
3. Ask for something and say ClipCat. Choose **Allow** when VS Code asks to run a ClipCat tool.

### Windsurf

1. Restart Windsurf, or open Cascade's MCP servers and choose **Refresh**.
2. Cascade's MCP list should show clipcat with its tools.
3. Ask Cascade for something and say ClipCat.

### LM Studio

1. Quit LM Studio and open it again, then load a model that can use tools.
2. In a chat, open the integrations menu and turn on `mcp/clipcat`.
3. Ask for something and say ClipCat. Small local models can miss steps, so check what it did in ClipCat.

### Gemini CLI

1. Start a new `gemini` session.
2. Type `/mcp`. clipcat should be listed as ready, with its tools.
3. Ask for something and say ClipCat. Approve each tool the first time Gemini CLI asks.

## Set up another MCP app

Any other app that runs local (stdio) MCP servers can use ClipCat too. In Settings, open **Set up another MCP app** under the list of agents. It shows the entry for this copy of ClipCat as JSON, plus the command, arguments and environment on their own, each with a copy button. Paste the JSON into the app's MCP settings file, inside its list of servers, or fill in its form with the parts.

ClipCat doesn't keep an entry you added by hand up to date, so copy it again if you move the app. Apps that only take remote (HTTP) MCP servers, such as ChatGPT, can't use ClipCat yet.

## Things to ask

Say "ClipCat" or "my ClipCat project" so the agent knows to use it. Keep ClipCat open while it works.

- "List my ClipCat projects and tell me which ones haven't been exported yet."
- "In ClipCat, cut the filler words and long pauses from my newest project. Show me what you'll cut before you do it."
- "Ask ClipCat's AI editor for cuts on my newest project, then accept the retakes and leave the rest for me."
- "In my newest ClipCat project, cut the part where I talk about pricing."
- "Add a zoom on each line where I give a number, and a whoosh where each new topic starts."
- "Make three ClipCat shorts of up to 60 seconds from my newest project."
- "Write the chapters and a YouTube description for my newest ClipCat project."
- "Import ~/Movies/take-1.mov and ~/Movies/take-2.mov into a new ClipCat project, and cut the retakes once it's transcribed."
- "Export my newest ClipCat project as a 9:16 video to my Desktop, and save a Final Cut Pro timeline beside it."

## Every tool it gets

The agent reads the transcript first. Every word has a number, and edits name words by number.

### Read

- **list_projects**: every project, newest first, with its id, name, length and number of recordings.
- **get_project**: one project's state: its revision, recordings, edited length, captions, suggestions by type and status, b-roll media, music, chapters, write-up and last export.
- **get_transcript**: the transcript with every word numbered, recording by recording, with times and long pauses marked. Cut words are shown `~like this~`.
- **list_proposals**: the suggested edits (cuts, zooms, b-roll and sounds), each with its id, its words and why. Lists waiting ones unless asked for accepted, rejected or all.
- **list_jobs**: what ClipCat is doing or just did: preparing, transcribing, AI passes and exports, with progress.

### Edit

- **cut_words**: cuts words from one number to another, or puts them back.
- **decide_proposals**: accepts or rejects suggestions by id, or puts them back to waiting.
- **edit_project**: any other change, as one operation:
  - a zoom (jump, smooth or slow) over words,
  - b-roll from the project's media over words, full frame or picture in picture,
  - a motion slide over words, from a brief, in the paper, ink or over-the-video look,
  - a sound effect on a word, by its id: whoosh, swish, pop, click, tick, ding, chime, riser, boom, blip, buzz, shutter or scratch,
  - a chapter on a word, or removing one,
  - retyping one misheard word,
  - the caption style, the speed, the shape, what fills the sides of a landscape video, and the music volume and dip,
  - the description and article, and the thumbnail's text, colours, side and position,
  - undo and redo.

### Start jobs

These run on the AI picked in ClipCat (your Claude Code, Codex or API key), not on the agent itself.

- **find_cuts**: asks ClipCat's AI editor for a whole edit from a brief, or for one change from a request. The suggestions arrive waiting for a decision.
- **write_up**: writes the chapters, description and article.
- **make_shorts**: makes up to a number of shorts of up to 30, 60 or 90 seconds, each its own project.

### Bring in and send out

- **import_videos**: adds video or audio files to a project, or to a new one. ClipCat prepares and transcribes them.
- **export_video**: exports the edit as an MP4 at 16:9 or 9:16 to a path, with an .srt beside it. A file already at that path is replaced.
- **export_timeline**: saves the edit as a Final Cut Pro, Premiere Pro or EDL timeline.

## Edits never clash

Every change names the project revision the agent last read. If you or the agent changed the project in between, the change is refused, and the agent reads the project again and retries. Nothing the agent does deletes your footage, and each change is one undo step in ClipCat.

## If it doesn't work

- **The agent doesn't know about ClipCat**: quit it completely and open it again, then check its tool list as above.
- **It says it can't reach ClipCat**: open ClipCat and ask again.
- **A change is refused because the project changed**: you or the agent edited it in between. Ask it to read the project again and retry.
- **AI cuts, shorts or the write-up fail**: those run on the AI you picked in ClipCat, so check it's set up on the **Edit** tab.
- **ClipCat can't update the agent's file**: it has comments or trailing commas in it. Add the entry by hand from **Set up another MCP app**.
- **Still stuck**: choose **Test** next to the agent in Settings to see which step fails, disconnect and connect again, or see [Fix a problem](troubleshooting.md).
