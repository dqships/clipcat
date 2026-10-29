---
title: Review the edit your AI suggests in ClipCat
description: Choose Claude Code, Codex or a Claude API key, ask for a first edit or one change, then accept or reject each suggested cut, zoom, b-roll and sound.
order: 6
updated: 2026-10-29
---

# Review the suggested edit

ClipCat's AI editor reads your transcript and suggests the first pass of the edit. Nothing changes until you accept a suggestion, and every decision can be undone or changed later.

ClipCat has no AI service of its own. It uses the AI you pick: your Claude Code, your Codex, or the Claude API with your own key. The AI gets one tool, for handing back its suggestions, and no access to your files, your terminal or the web. ClipCat checks each suggestion against your transcript before showing it.

## Pick the AI

The **AI editor** section is at the top of the **Edit** tab.

- **Use**: Claude Code, Codex or Claude API (your key). One that can't run yet says "(not set up)". Your choice is kept for every project.
- **Model**, for Claude Code and Codex: leave it on the default to use the agent's own default model, or pick one. Codex lists the models your login can use.
- **Model**, for the Claude API: Opus 5.5 (best), Sonnet 5.5, or Haiku 5.5 (cheapest).

### Claude Code or Codex

ClipCat runs the `claude` or `codex` command already on your computer, signed in to your own plan. Install it and sign in once (`claude auth login` or `codex login` in a terminal), or install it from [Settings](settings.md). If it isn't ready, the section says why. Fix it, then choose **Check again**.

### Claude API

Paste a key from console.anthropic.com and choose **Save key**. ClipCat tries the key with one call before saving it, then keeps it encrypted with your system's keychain. Each run is billed to your Anthropic account. **Remove key** deletes it.

## Ask for the first edit

1. Optionally, say what the edit should do under **What should the edit do?**. For example: "Keep the intro, cut the tangent about pricing". ClipCat keeps this for the project.
2. Choose **Suggest an edit**. It needs the transcript to be ready.

The AI suggests:

- **Retake**: a line you said again. It keeps the better take.
- **Filler words**: ums, ahs and false starts.
- **Tangent**: a stretch that wanders from the point.
- **Zoom**: a zoom in on a line that matters.
- **B-roll**: one of your pictures or clips over a line that matches it.
- **Slide**: a short animated card where seeing the words helps.
- **Sound**: a sound effect on the word it belongs to.

It also suggests a title, shown under the section with a **Copy** button.

**Suggest again** asks for a new pass. It replaces the suggestions still waiting and never asks again about one you already decided.

## Ask for one change

Type a request under **Ask for a change**, like "Cut the part about pricing", and press Enter or choose **Send**. The suggestions for it join the ones already waiting.

## Accept or reject

**Suggested edits** lists everything waiting, with a count like "4 cuts, 1 zoom and 2 sounds to review, 1:12 in all". Pauses ClipCat found after import are here too, as **Silence**.

- Click a suggestion to play its spot in the preview.
- Choose the check mark to accept it, or the cross to reject it.
- **Accept all** and **Reject all** decide everything waiting at once.

Accepting a cut removes its words. Accepting a zoom, b-roll, slide or sound adds it to the edit. Rejecting leaves the video as it is.

## Change a decision

Decided suggestions move to **History** under the list, marked Accepted or Rejected. Open it and choose the cross to reject an accepted one instead, or the check mark to accept a rejected one. Undo (Cmd+Z or Ctrl+Z) also takes back the last decision.

## What leaves your computer

When you ask the AI for something, the text of the transcript goes to the AI you picked. For b-roll, a few still frames of your pictures and clips go too. Your video doesn't. See [Where your files are](files-and-privacy.md).
