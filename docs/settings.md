---
title: Every ClipCat setting and what it does
description: Every ClipCat setting explained: connecting a coding agent, installing Claude Code or Codex, transcription language and models, updates and diagnostics.
order: 14
updated: 2026-10-29
---

# Settings

Open Settings with the gear in the library. Settings apply to every project and are saved on your computer.

Settings has four pages, listed on the left: **Coding agents**, **Transcription**, **Updates** and **Troubleshooting**. Under each name is a few words on where it stands, like how many agents are connected or whether an update is ready, so you can see it without opening the page. Choose a name to open its page. Settings opens on the page you had open last.

Two more kinds of settings live where you use them:

- The AI editor (which AI, its model and your Claude API key) is on the **Edit** tab of any project. See [Review the suggested edit](ai-editor.md). Your choice applies to every project.
- The list of names and words to spell right is at the top of the transcript. See [Edit the transcript](transcript.md). It's kept for every project too.

## Coding agents

Connect Claude Code, Codex or the Claude desktop app, and it can edit your projects while ClipCat is open. Under **Connections**, each agent has a row:

- The line under its name says whether it's connected, when it last connected, or that it isn't on this computer. You can connect an agent before you install it.
- The path is the agent's own settings file, where ClipCat adds its entry.
- **Connect** shows the exact entry ClipCat will add and asks first. **Add to** (the agent's name) adds it, then ClipCat checks the connection.
- **Test** checks the connection again, step by step: the file is read back, the entry is run through to ClipCat, and the agent's own command is asked. The last step turns to done once the agent really connects.
- **Disconnect** takes ClipCat's entry out of the file. Nothing else in the file changes.

### Install or update Claude Code and Codex

The Claude Code and Codex rows also show the version of the command-line tool on your computer next to the newest release.

- **Install Claude Code** or **Install Codex** runs its maker's own install script.
- **Update to** (a version) updates it the way it was installed: its own updater, npm, bun, Homebrew or winget, so you don't end up with two copies.
- Next to the button is the exact command it runs. Its output shows while it runs.
- A copy that came inside another app is left to that app, and the row says how to update it.
- If your Codex is older than another Codex on your computer (usually the one inside the ChatGPT app), the row warns that the newer one's settings may not work in it.

The **How to use it** part of the page, under the agents, walks through the first session for each agent, with prompts to copy. See [Use ClipCat from Claude or Codex](agents.md).

## Transcription

- **Language for new projects**: the language ClipCat transcribes new projects in. English unless you change it. **Detect automatically** has whisper guess the language from the first seconds of speech, and skips Parakeet. Each project can change its own language from the transcript.
- **Whisper model**: **Large v3 Turbo** (most accurate, the default) or **Base** (fastest, less accurate).
- **Engine** (Apple Silicon only): **Parakeet when it knows the language** (the default) or **Always whisper**.

The choices above are under **New projects**. Under **Speech models on this computer**, each speech model has a row that says whether it's downloaded and how big it is.

- **Download** gets it now, with progress, so the first transcription doesn't wait. Otherwise it downloads the first time it's needed.
- **Delete** removes it to free the space. It downloads again when needed.

A model is loaded only while it transcribes. See [Add videos and transcribe them](importing.md).

## Updates

ClipCat checks for a new version when it opens and every four hours after. The Updates page says what it found.

- **Check now** checks again.
- **Restart to update** shows when a new version has downloaded. The status line at the foot of the window shows it too.
- **Open the release page** shows when this copy can't install the update itself. Download the new version there.

A copy you built yourself doesn't update.

## Troubleshooting

- **Save diagnostics** saves one zip: ClipCat's log, its versions and setup, recent jobs, each project's history and crash reports. It holds no video, sound or transcript, and your home folder's name is replaced with `~`. Attach it to a bug report.
- **Show the log** opens the folder with ClipCat's log.

See [Fix a problem](troubleshooting.md).
