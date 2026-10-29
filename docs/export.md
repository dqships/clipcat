---
title: Export a ClipCat video as MP4 or an editor timeline
description: Export the edit as an MP4 at 16:9 or 9:16 with captions, change the playback speed, or save a timeline for Final Cut Pro, Premiere Pro or any editor.
order: 13
updated: 2026-10-29
---

# Export the video

Everything here is on the **Export** tab. The top line says how long the edit runs.

## Export a video

1. Pick the **Playback speed**, from 0.5× to 2×. Normal is 1×. The preview plays at this speed too.
2. Choose **Export 16:9** (landscape, up to 1440p) or **Export 9:16** (vertical 1080×1920, cropped around you).
3. Pick where to save the MP4.

The progress line under the preview shows the export. The cross next to it cancels the export, and no half-finished file is left behind.

When it's done, **Last export** names the file. **Show file** opens its folder.

### What's in the file

- H.264 video at your recordings' own frame rate, made with your computer's own hardware encoder when it has one.
- The captions, if they're on, burned in.
- Zooms, b-roll, slides, sound effects and music.
- The chapters as chapter markers, and the title.
- The thumbnail as cover art, if you made one.
- An .srt caption file beside the MP4, with the same name.

Export reads your original recordings, not the preview copies, so keep them where they were when you added them.

## Finish in another editor

To finish the cut in another editor, save the edit as a timeline of your original recordings:

- **Final Cut Pro**: an .fcpxml file. DaVinci Resolve opens it too.
- **Premiere Pro**: a Final Cut 7 .xml file. Resolve opens it too.
- **EDL**: a CMX 3600 .edl file, for any editor.

The timeline has every kept stretch at normal speed, with the chapters as markers. Captions, zooms, b-roll and sound stay in ClipCat.
