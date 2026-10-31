---
title: Edit the transcript to edit the video in ClipCat
description: Cut and restore words in ClipCat's transcript to cut the video, fix misheard words, teach it the names you use, and hide cuts to read only what's kept.
order: 5
updated: 2026-10-31
---

# Edit the transcript

In ClipCat the transcript is the edit. Cutting words cuts that part of the video, and the preview skips it.

## Read the transcript

- Cut words are struck through.
- Words a suggested cut would remove are highlighted until you accept or reject it.
- Words with a zoom or b-roll on them are marked.
- The word being spoken is highlighted as the preview plays.
- In a project with several recordings, each one starts with its file name.

## Jump and select

- **Click a word** to jump the preview there and select it.
- **Shift-click** another word to select everything from the first one to it.
- **Esc** clears the selection.

The bar above the transcript says how many words are selected and what you can do with them.

## Cut and restore

Select words, then press **Delete** (or Backspace) or choose **Cut**. A cut runs from the middle of the pause before the words to the middle of the pause after, so the speech either side keeps its breath.

To bring words back, select them and press Delete again or choose **Restore**. Undo works too: Cmd+Z on a Mac, Ctrl+Z on Windows.

## Add things to the selection

With words selected, the bar also offers:

- **Zoom in**: zooms in on you for those words. See [Add zooms, b-roll and slides](zooms-and-b-roll.md).
- **B-roll…**: shows one of your pictures or clips over those words. Add them in the B-roll section first.
- **Slide**: type what the slide says, pick a look, and choose **Add slide**. The AI editor designs it.
- **Chapter**: starts a chapter on the first selected word. Name it in [Chapters and article](chapters-and-article.md).
- **Sound…**: lands a sound effect on the first selected word. See [Add sound effects and music](sound.md).
- **Music…**: plays one of the project's music tracks over the selected words. See [Add sound effects and music](sound.md#music).

Zoom, b-roll and slides need words from one recording.

## Fix a misheard word

1. Double-click the word, or select it and choose **Fix word**.
2. Type the word as it was said. One word only.
3. Press Enter to save it, or Esc to leave it as it was.

The fix carries everywhere: the captions, the write-up and what the AI reads. Hover a fixed word to see what was heard.

## Fix the spelling of names

Speech recognition often misspells names and product words. ClipCat keeps one list of them for every project.

1. At the top of the transcript, open **Fix the spelling of names**.
2. Type the names and words, separated by commas. For example: ClipCat, DaQuan, Vercel.
3. Choose **Fix spelling**. Your AI corrects this transcript to match, changing only words it's sure of and keeping their timing.

Whisper also reads the list as a hint while it transcribes. Parakeet doesn't take hints, so on Apple Silicon use Fix spelling. It needs the AI editor to be set up (see [Review the suggested edit](ai-editor.md)).

## Hide cuts

Choose the eye in the title bar to leave cut words out of the transcript and close up the cuts in the strip. The transcript then reads the way the edit plays. Choose it again to see the cuts.

## Change the language

**Language** at the top of the transcript transcribes the project again in another language. See [Add videos and transcribe them](importing.md).
