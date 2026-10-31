# ClipCat tasks

## Next

- Review the PR from `claude/ai-providers-music-settings`.
- Bump the version and write the release notes once the PR is approved.
- Test by hand: recording (camera, microphone, screen), Claude Code as the AI editor (it isn't installed on the dev Mac), and Save Diagnostics (it opens a save dialog).

## Done

- 2026-10-31: Claude API runs work again. The answer schema had an enum beside a list of types, which the API refused with a 400.
- 2026-10-31: An old failure no longer stays on screen after a newer run. Failures name the AI and model on screen, in the log and in the project's history, and a run says what it came to.
- 2026-10-31: Tested in a local build with real keys: Claude API, OpenAI, OpenRouter and Codex each passed suggest, request, spelling, write-up, shorts, describe and slide (28 of 28). Claude API's Haiku and Opus passed a request too.
- 2026-10-31: Settings has one AI models page holding the AI editor and the coding agents. The coding agents part keeps Things to ask and a link to the full guide.
- 2026-10-31: A project can have several music tracks: one under the whole video, others placed on words by hand or by the AI editor. Old projects open with their one track.
- 2026-10-31: OpenRouter lists only models that read images and use tools.
- 2026-10-31: Videos dragged in from Photos are copied into the project, because macOS deletes the temporary file. Older projects export and make thumbnails from the preview copy.

## Decisions

- 2026-10-31: Only OpenRouter models that take text and images and use tools are offered.
- 2026-10-31: Replace the How to use it walkthrough with Things to ask and the full guide link, since Help covers the rest.
- 2026-10-31: Nothing ships until it has been tested in a local build.
