---
title: Fix a problem in ClipCat and report a bug
description: What to do when ClipCat's AI, transcription, recording, export or agent connection doesn't work, and how to report a bug with a diagnostics file.
order: 19
updated: 2026-10-29
---

# Fix a problem

## The AI editor isn't ready

The **AI editor** section on the **Edit** tab says what's wrong.

- **Claude Code or Codex isn't installed**: install it from [Settings](settings.md), or with its maker's instructions.
- **It isn't signed in**: run `claude auth login` or `codex login` in a terminal, then choose **Check again**.
- **ClipCat can't find it**: ClipCat looks on your terminal's PATH and in the usual install folders. If it's somewhere else, set `CLIPCAT_CLAUDE_PATH` or `CLIPCAT_CODEX_PATH` to its full path and reopen ClipCat.
- **Codex refuses the model**: an older Codex can't run a model a newer one set in `~/.codex/config.toml`. Update Codex from Settings, or pick a model on the **Edit** tab.
- **The API key is refused**: check it on console.anthropic.com, then remove it and save it again.

## A suggestion pass fails

The error shows in the AI editor section. Try again: a busy or rate-limited AI is the usual cause. If your plan's limit is reached, wait for it to reset, or switch to another AI under **Use**.

## The transcript is empty or wrong

- **"No speech found"**: the recording may be in another language. Pick it under **Language** and choose **Transcribe again**.
- **Names are misspelled**: use **Fix the spelling of names** at the top of the transcript, or double-click a word to fix it.
- **Transcription is slow**: on Intel Macs and Windows, whisper runs on the processor. Pick the **Base** whisper model in Settings for speed, at some cost in accuracy.
- **The model won't download**: check your internet connection, then choose **Download** next to the model in Settings.

## Recording doesn't start

- **"ClipCat isn't allowed to use the camera"** (or the microphone, or the screen): choose **Open privacy settings** and allow ClipCat. For the screen on a Mac, quit and reopen ClipCat.
- **"No camera or microphone found"**: plug it in, then go back and open the recorder again.

## Export fails or looks wrong

- **An original recording was moved or deleted**: export reads the originals. Put the file back where it was.
- **The vertical crop misses you**: on the **Look** tab, untick **Follow the speaker** and drag **Position**.
- **The disk is full**: export needs room for the video while it works. Free some space and export again.

## The status line shows a missing tool

The status line at the foot of the window names a tool ClipCat couldn't find, like ffmpeg. Reinstall ClipCat from [the download page](https://clipcat.followusai.com/download).

## A coding agent can't use ClipCat

See [If it doesn't work](agents.md#if-it-doesnt-work) on the agents page.

## Report a bug

1. In ClipCat, choose **Help > Save Diagnostics**, or open **Settings > Troubleshooting** and choose **Save diagnostics**. It saves one zip with ClipCat's log, versions and recent jobs, and no video, sound or transcript.
2. Choose **Help > Report an Issue**. It opens a new issue on [GitHub](https://github.com/dqships/clipcat/issues) with your ClipCat version and system filled in. Say what you did, what you expected and what happened.
3. Attach the zip.
