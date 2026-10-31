---
title: Make your first video with ClipCat
description: Install ClipCat, set up the AI that suggests your edit, and go from a raw talking-head take to an exported video, the shorts and a description.
order: 1
updated: 2026-10-31
---

# Make your first video

This page takes you from installing ClipCat to an exported video. Each step links to the page with the details.

## What you need

- A Mac with macOS 14 or newer (Apple Silicon or Intel), or a 64-bit Windows 10 or 11 PC.
- One of these for the AI suggestions: a Claude plan with [Claude Code](https://claude.com/claude-code), a ChatGPT plan with Codex, or your own Claude, OpenAI or OpenRouter API key. Everything else in ClipCat works without one.
- There's no ClipCat account. Nothing to sign up for.

## 1. Install ClipCat

1. Download the installer from [the download page](https://clipcat.followusai.com/download). Pick the Intel version if your Mac's About This Mac says Processor rather than Chip.
2. On a Mac, open the DMG and drag ClipCat to Applications. On Windows, run the installer.
3. Open ClipCat. You see the library, which is empty the first time.

The first time you open ClipCat on a Mac, macOS stops it and says it can't verify the app, because ClipCat isn't notarized by Apple. Choose **Done**, then open **System Settings > Privacy & Security**, scroll down to **Security**, choose **Open Anyway** next to ClipCat, and enter your password. You only do this once.

## 2. Bring in a take

Choose **Add videos** and pick one or more recordings, or drag files from Finder or Explorer onto the window. Each import makes a new project. To record straight into ClipCat instead, choose **Record**. See [Record a take](recording.md) and [Add videos and transcribe them](importing.md).

ClipCat now prepares each recording and transcribes it on your computer. The first time, it downloads the speech model once (a few hundred megabytes). The project card shows the progress.

## 3. Open the project

Choose the project's name. The editor opens with the preview in the middle, the transcript beside it, and the tools below it. See [Find your way around the editor](editor.md).

Long pauses are already suggested as cuts. They're listed under **Suggested edits** on the **Edit** tab.

## 4. Set up the AI editor

Open **Settings > AI models** (the gear in the library, or **Set up** in the **AI editor** section of the **Edit** tab) and pick one:

- **Claude Code**: install it and sign in once by running `claude auth login` in a terminal. Or install it from the same page.
- **Codex**: install the Codex CLI and run `codex login` once.
- **Claude API**, **OpenAI** or **OpenRouter**: paste your key and choose **Save key**.

If the AI isn't ready, its row says why. See [Settings](settings.md#ai-models).

## 5. Get the suggested edit

Choose **Suggest an edit**. You can first tell it what the edit should do, like "Keep the intro, cut the tangent about pricing". After a minute or two, the suggestions appear under **Suggested edits**: retakes, filler words, tangents, zooms, b-roll and sound effects, each with a reason.

Click a suggestion to play that spot. Choose the check mark to accept it or the cross to reject it, or use **Accept all**. See [Review the suggested edit](ai-editor.md).

## 6. Fix what's left in the transcript

Click a word to jump there. Shift-click another word to select everything between, then press Delete to cut it. Double-click a word to fix its spelling. Press Cmd+Z on a Mac or Ctrl+Z on Windows to undo. See [Edit the transcript](transcript.md).

## 7. Set the look

On the **Look** tab, pick the shape (landscape 16:9 or vertical 9:16) and the caption style. See [Set the shape and captions](shape-and-captions.md).

## 8. Export

On the **Export** tab, choose **Export 16:9** or **Export 9:16** and pick where to save the MP4. An .srt caption file is saved beside it. See [Export the video](export.md).

## Next

- Make shorts from the same recording: [Make shorts](shorts.md).
- Write the chapters, description and article: [Write the chapters and article](chapters-and-article.md).
- Make a thumbnail: [Make a thumbnail](thumbnail.md).
- Let Claude Code, Codex, Cursor or another agent do the editing for you: [Use ClipCat from your coding agent](agents.md).
