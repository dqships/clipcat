---
title: Add videos to ClipCat and transcribe them
description: The video and audio files ClipCat opens, what it does after import, how transcription works on your computer, and how to change a project's language.
order: 4
updated: 2026-10-29
---

# Add videos and transcribe them

## Add videos

In the library, choose **Add videos** and pick your recordings, or drag them onto the window. You can also choose **File > Import Videos** (Cmd+O) from anywhere, which opens the new project. Everything you add at once becomes one new project, named after the first file. The recordings play one after another in the order you picked them.

ClipCat opens MP4, MOV, M4V, MKV, WebM and AVI videos, and MP3, WAV, M4A, AAC and FLAC audio. It reads your files where they are and doesn't copy them, so keep them where they are while you work on the project. The export reads the originals.

To add more videos to a project you already have, open it and choose **File > Add Videos to Project** (Shift+Cmd+O). They play after the ones already there. You can also choose **Record another take**, or ask a connected agent to import the file (see [Use ClipCat from your coding agent](agents.md)).

## What happens next

For each recording, ClipCat runs these steps in order. The project card and the editor show each one as it runs.

1. **Preparing**: makes a light copy for the preview, the sound for transcription, a few still frames and the waveform for the strip.
2. **Transcribing**: turns the speech into words with their times, on your computer.
3. **Finding pauses**: marks long silences and suggests them as cuts. They show under **Suggested edits**, ready to accept or reject.
4. **Finding the face**: looks for your face every 2 seconds, so a vertical crop can follow you.

You can open the project and watch while these run. If ClipCat quits partway, it picks up the missing steps next time.

## How transcription works

Nothing is uploaded. ClipCat uses one of two speech engines:

- **Parakeet** runs on Apple Silicon Macs. It hears 25 European languages, works out which one you speak, and is the fastest.
- **Whisper** runs on every Mac and Windows PC and hears about 100 languages. It takes any language Parakeet doesn't know, and it's the only engine on Intel Macs and Windows.

The first time an engine runs, its model downloads once (a few hundred megabytes) from Hugging Face. You can download models ahead of time, choose the whisper model or always use whisper in [Settings](settings.md). The [languages page](https://clipcat.followusai.com/languages) lists every language.

## Change a project's language

New projects are transcribed in the language set in [Settings](settings.md), English unless you change it.

To transcribe one project in another language:

1. At the top of the transcript, open **Language**.
2. Pick the language, or **Detect automatically** to let whisper guess it from the first seconds of speech.
3. Choose **Transcribe again**.

This replaces the transcript, including words you fixed, and clears suggested edits you haven't reviewed. Cuts you made stay.

If a recording comes back with no words, the transcript says "No speech found" and shows the language picker, since the most common reason is the wrong language.
