# ClipCat tasks

## Next

- Review the PR from `claude/ai-providers-music-settings`.
- Bump the version and write the release notes once the PR is approved.
- Test by hand: recording (camera, microphone, screen), Claude Code as the AI editor (it isn't installed on the dev Mac), Connect and Disconnect, the menu bar and its shortcuts, and Windows.
- Review PR 65 (Play from the beginning and full Undo), which is based on PR 64.

## On hold

- Edit how slides look (put on hold 2026-10-31, nothing built). Per slide: style controls (background, text and accent colours, font, text size, alignment) that show live with no AI call, and a full editor (select, drag, resize, edit text in place, add, delete, layer order, snap to guides) that survives export exactly and keeps working with the slide's animation. Manual work must never be silently overwritten, and Undo and the MCP server must cover it.
  - Proposed plan, not yet approved: `Slide` gains `scene` and `edited`. `scene` holds the style and a wide and a tall layout of ordered layers (text, shape, drawing), with boxes as shares of the frame and colours as named slots. `html` stays what renders and is regenerated from `scene`, so preview, editor and export load one page. Position and entrance are kept apart, so a moved layer keeps its entrance. Old slides keep their look and get a free **Make editable** button that reads the final frame into layers.
  - Open decisions: which fonts to bundle (only Jost SemiBold ships today); whether the AI writes layers instead of free HTML, which drops script-drawn motion and needs every provider tested again.
  - Found while planning: the preview lays a slide out at its design size, but the export uses the export size, so a slide can differ between them after a shape change. A very short slide (0.8 s) can show only part of its animation in the paused preview. Undoing a redesign brings the old design back, but its list thumbnail keeps the new design's stills.

## Done

- 2026-10-31: Play from the beginning: a transport button, Enter, and a Playback menu item jump to the edit's first kept moment and play, even if it's already playing. Enter keeps its job in boxes, menus and dialogs, and on a button reached with Tab.
- 2026-10-31: Every change to the edit is now one undo step, including word fixes, captions, speed, shape, framing, chapters, write-up, thumbnail, music and removing media or music. One drag of a slider is one step. Removed media and music keep their files until they leave the history.
- 2026-10-31: Exports no longer hang on music. ffmpeg froze when an endless loop restarted a file after its stretch ended, and when ducked music ended before the speech.
- 2026-10-31: Exported captions match the preview's size, and boxed word-by-word captions are one clean box.
- 2026-10-31: OpenAI and OpenRouter runs ask once more when the connection drops mid-request, and the error says why it dropped.
- 2026-10-31: The tool tabs follow DESIGN.md (ghost text with a tape strip), and the transcript's action row uses chevrons instead of a scrollbar.
- 2026-10-31: Blurred bars are smooth in the preview, Help search puts the exact phrase first, and titles ending in a full stop no longer give `..mp4`.
- 2026-10-31: Deep test in a local build: all 12 picture-in-picture mixes in both shapes, zoom styles and sound volumes measured in the export, music handover, slides, speed, shorts, a second recording, Transcribe again, panels, Settings, Help, Save Diagnostics and delete.
- 2026-10-31: Claude API runs work again. The answer schema had an enum beside a list of types, which the API refused with a 400.
- 2026-10-31: An old failure no longer stays on screen after a newer run. Failures name the AI and model on screen, in the log and in the project's history, and a run says what it came to.
- 2026-10-31: Tested in a local build with real keys: Claude API, OpenAI, OpenRouter and Codex each passed suggest, request, spelling, write-up, shorts, describe and slide (28 of 28). Claude API's Haiku and Opus passed a request too.
- 2026-10-31: Settings has one AI models page holding the AI editor and the coding agents. The coding agents part keeps Things to ask and a link to the full guide.
- 2026-10-31: A project can have several music tracks: one under the whole video, others placed on words by hand or by the AI editor. Old projects open with their one track.
- 2026-10-31: OpenRouter lists only models that read images and use tools.
- 2026-10-31: Videos dragged in from Photos are copied into the project, because macOS deletes the temporary file. Older projects export and make thumbnails from the preview copy.

## Decisions

- 2026-10-31: Transcript actions stay on one row with chevrons, because wrapping would move the words between the two clicks of a double-click.
- 2026-10-31: Only OpenRouter models that take text and images and use tools are offered.
- 2026-10-31: Replace the How to use it walkthrough with Things to ask and the full guide link, since Help covers the rest.
- 2026-10-31: Nothing ships until it has been tested in a local build.
- 2026-10-31: Slide editing is on hold; build Play from the beginning now.
