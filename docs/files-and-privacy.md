---
title: Where ClipCat saves files, and what leaves your computer
description: Where ClipCat keeps projects, takes, speech models, exports and its log on Mac and Windows, and exactly what is sent to your AI and when.
order: 17
updated: 2026-10-29
---

# Where your files are

ClipCat has no account and no server of its own. Your projects are saved on your computer.

## On your computer

| What | Mac | Windows |
| --- | --- | --- |
| Projects | `~/Library/Application Support/ClipCat/projects` | `%APPDATA%\ClipCat\projects` |
| Speech models | `~/Library/Application Support/ClipCat/models` | `%APPDATA%\ClipCat\models` |
| Settings | `~/Library/Application Support/ClipCat` | `%APPDATA%\ClipCat` |
| ClipCat's log | `~/Library/Application Support/ClipCat/logs/main.log` | `%APPDATA%\ClipCat\logs\main.log` |
| Recorded takes | `~/Movies/ClipCat` | your Videos folder, in `ClipCat` |
| Exports, thumbnails, articles, timelines | Wherever you save them | Wherever you save them |

To open a project's folder, use **Show in Finder** (or **Show in Explorer**) in its menu in the library.

A project's folder holds its edit, the transcript, light preview copies of the recordings and pictures, the waveforms, the faces found, thumbnail cutouts and a history of what happened to it. It doesn't hold your original recordings. ClipCat reads those where they are, so keep them there while you work on the project.

Deleting a project removes its folder. Your original recordings and recorded takes stay.

Your Claude API key, if you saved one, is stored encrypted with your system's keychain, not in the settings file.

## What leaves your computer

- **When you ask the AI for something** (a suggested edit, a change, fixing spelling, shorts, the write-up or a slide): the text of the transcript goes to the AI you chose, your Claude Code, your Codex or the Claude API with your key. For b-roll and slides, a few still frames go with it. Their own privacy terms apply.
- **Speech models** are downloaded once from Hugging Face.
- **Update checks** read the list of releases on GitHub.
- **Installing or updating Claude Code or Codex** from Settings runs their makers' install scripts, which download from them.

Nothing else. Transcription, face finding, the thumbnail cutout and the export all run on your computer. ClipCat sends no analytics, usage data or crash reports. Crash reports stay in the log folder and go only where you attach them yourself.

## Agents you connect

A connected agent (see [Use ClipCat from Claude or Codex](agents.md)) talks to ClipCat on your computer. What the agent then sends to its own service follows that agent's terms.
