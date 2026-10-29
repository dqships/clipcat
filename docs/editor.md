---
title: Find your way around the ClipCat editor
description: The parts of ClipCat: the library, the preview and its playback controls, the strip, the transcript and tools panels, hiding cuts, and the menu bar.
order: 2
updated: 2026-10-29
---

# Find your way around the editor

ClipCat has four screens: the library, the editor, the recorder and Settings. A status line at the foot of every screen shows ClipCat's version, whether its video tools work, and an update when one is waiting.

## The library

The library is the first screen. It lists your projects, newest first. Each card shows the project's length and how many recordings it has, or which video a short was cut from, and a progress line while ClipCat is working on it.

- **Add videos** starts a new project from files. You can also drop files anywhere on the library.
- **Record** starts a new project from a take you record. See [Record a take](recording.md).
- The gear opens [Settings](settings.md).
- Choose a project's name to open it.

Each project has an options button (the three dots). You can also right-click a card, or press and hold it. The menu has:

- **Open**.
- **Rename**: type the new name and press Enter, or press Esc to keep the old one.
- **Show in Finder** (Show in Explorer on Windows): opens the project's folder.
- **Delete**: asks first, with **Delete project** and **Keep project**. Deleting removes the project and everything ClipCat made for it. Your original recordings stay where they are.

## The editor

Open a project to edit it. The title bar has:

- The back arrow, which returns to the library.
- The project's name. Click it to rename the project.
- **Record another take** (the camera): records a new take into this project.
- **Hide cuts** (the eye): leaves cut words out of the transcript and closes up the cuts in the strip, so you read and see only what's kept. Choose it again to show cuts. ClipCat remembers your choice.
- **Undo** and **Redo**. Every change is one step, including ones an agent makes. Cmd+Z and Shift+Cmd+Z do the same on a Mac, Ctrl+Z and Shift+Ctrl+Z on Windows.

ClipCat saves every change as you make it. There's no Save button.

## The preview

The preview plays the edit: cuts are skipped, and zooms, b-roll, slides, captions, sound effects and music play as they will in the export. In a vertical project the preview is vertical too.

Under the preview are the playback controls, from left to right:

- **Play backwards** (J): each press plays backwards faster.
- **Back one frame** (Left arrow). Shift+Left goes back a second.
- **Play** or **Pause** (Space, or K to pause).
- **Forward one frame** (Right arrow). Shift+Right goes forward a second.
- **Play forwards** (L): each press plays faster.
- The time in the edit and the edit's length. While playing faster or backwards, the speed shows beside it.

These keys work anywhere in the editor except while you type in a box. See [Keyboard shortcuts](shortcuts.md).

## The strip

Below the controls is the strip: the waveform of the recording under the playhead. Cuts are shaded, and suggested cuts waiting for a decision are outlined. Click anywhere on it to jump there. With cuts hidden, the kept stretches sit side by side and a thin seam marks each cut.

When ClipCat is working on the project (transcribing, asking the AI, exporting), a progress line shows under the strip with a cancel button.

## The panels

The transcript and the tools are panels around the preview. Each panel's header has three buttons to put it on the left, at the bottom or on the right. Two panels in the same place share it, transcript first.

Drag the thin line between a panel and the preview to make it bigger or smaller. You can also focus the line with Tab and use the arrow keys, or Home and End for the smallest and largest size. ClipCat remembers the layout.

- **Transcript**: the words, where you make cuts. See [Edit the transcript](transcript.md).
- **Tools**: four tabs in the order the work goes.
  - **Edit**: the AI editor, suggested edits, zooms, b-roll and sound. The tab shows how many suggestions are waiting.
  - **Look**: the video shape and captions.
  - **Publish**: the thumbnail, chapters and article, and shorts.
  - **Export**: the speed, video export and timelines for other editors.

Use the Left and Right arrows to move between the tabs when one has focus. Whatever you type on a tab stays when you switch to another.

## The menu bar

On a Mac the menus are at the top of the screen; on Windows they're at the top of the window. Items for a project are off until you open one. The keys are listed in [Keyboard shortcuts](shortcuts.md).

- **ClipCat** (Mac only): About ClipCat, Check for Updates, Settings, and Quit.
- **File**:
  - **New Recording** opens the recorder for a new project.
  - **Import Videos** makes a new project from the files you pick and opens it.
  - **Add Videos to Project** adds the files you pick to the open project.
  - **Open Recent** lists the last 10 projects you opened. **Clear Menu** empties the list and keeps the projects.
  - **Export** opens the Export tab.
  - **Show in Finder** (Show in File Explorer on Windows) opens the project's folder. See [Where your files are](files-and-privacy.md).
  - On Windows, **Settings** and **Exit** are here too.
- **Edit**: **Undo** and **Redo** undo the last change to the project, or your typing when you're in a text box. Cut, Copy, Paste and Select All work in text boxes.
- **View**: the four tools tabs, **Hide Cuts**, the zoom of the whole window, and full screen.
- **Playback**: play, pause, play backwards or forwards, and step a frame or a second.
- **Window**: minimize the window, or on a Mac zoom it and bring it to the front.
- **Help**: see [Help in the app](README.md#help-in-the-app).
