# ClipCat

A personal AI video editor for talking-head videos. Drop in raw takes; ClipCat
transcribes them locally, proposes cuts for retakes and silences using your own
Claude Code or Codex, and exports a captioned video in 16:9 and 9:16.

Electron app for macOS (Apple Silicon first) and Windows. The design system is
in [DESIGN.md](DESIGN.md); read it before touching any screen.

## Layout

| Path | What |
| --- | --- |
| `apps/desktop` | Electron main process and preload (all media and AI work happens here) |
| `apps/ui` | React 19 + Vite renderer, sandboxed, styled only with design tokens |
| `packages/core` | The project model and pure edit logic: timeline, cuts, silence, proposal checks |
| `packages/ipc` | The typed contract between main and UI (zod schemas) |
| `design/` | Design tokens generated from DESIGN.md |
| `brand/` | Logo, app icons and their generator |
| `scripts/` | `fetch-ffmpeg` (pinned static builds), `build-whisper` (whisper.cpp from a pinned commit), `check-tokens` (no raw values in UI) |
| `apps/site` | Marketing site (coming later), deployed on its own by Vercel |

## Develop

```sh
npm install
npm run fetch:ffmpeg   # ffmpeg + ffprobe for this machine into vendor/
npm run build:whisper  # whisper-cli into vendor/ (needs git, cmake and a C++ compiler)
npm run dev            # Vite + Electron
npm run check && npm test && npm run lint:tokens
npm run make           # installers in apps/desktop/out/make (set SKIP_SIGN=1 for unsigned)
```

Smoke test a packaged build: `CLIPCAT_SMOKE=1 <path to ClipCat binary>` prints one
JSON line and exits 0 when the UI drew and the bundled ffmpeg and whisper-cli ran.
Add `CLIPCAT_SMOKE_IMPORT=<video>` to also import, transcribe and analyse a file
(`CLIPCAT_MODEL=base` uses the small speech model).

Projects live in the app's data folder (`~/Library/Application Support/ClipCat/projects`
on macOS, `%APPDATA%\ClipCat\projects` on Windows); the speech model downloads
once into `models/` beside them.

AI cuts use your own Claude Code: install it and run `claude auth login` once.
ClipCat finds `claude` on your login shell's PATH (or `CLIPCAT_CLAUDE_PATH`) and
gives it a single tool, `submit_analysis`, which runs inside the app; it gets no
file, shell or web access. Proposals are checked against the transcript and
nothing is cut until you accept it.

Codex works too: install the Codex CLI, run `codex login`, and pick Codex under
"Find cuts with" (or set `CLIPCAT_CODEX_PATH`). ClipCat runs `codex exec` in a
read-only sandbox in an empty temporary folder, with the prompt on stdin and
the answer held to a JSON schema; it is checked exactly like Claude's.

The AI editor also takes one-off requests ("cut the part about pricing"), which
add proposals next to the ones waiting, and fixes misheard names: list the
names and terms you use, and "Fix transcript" corrects only the words it is
sure of, keeping their timing (hover a corrected word to see what was heard).
The same list is passed to whisper as a prompt when transcribing.

Editing happens in the transcript: click a word to jump there, shift-click to
select a run, and press Delete to cut it (again to restore). Suggested cuts,
from the pause finder and from Claude, are accepted or rejected under the
preview. Every edit is undoable with Cmd/Ctrl+Z and redone with
Shift+Cmd/Ctrl+Z, and the preview plays the edit with the cuts skipped.

Export renders the edit with ffmpeg: 16:9 at the recordings' own height (up to
1440p) or 9:16 at 1080×1920, cropped around the speaker, at the speed set in the
Export panel (0.5× to 2×, which the preview plays at too). Every kept range is
snapped to whole frames, the picture is rendered four minutes at a time, each
chunk seeking straight to its part of the recordings, and the sound in one pass;
the two are joined without re-encoding, so a long video stays in sync and a
cancel (the × beside the progress bar) stops at once. The H.264 encoder is the
machine's own: VideoToolbox on a Mac; on Windows NVENC, Quick Sync, AMF or Media
Foundation, whichever encodes a test clip first. libx264 takes over if it fails.
Captions are built from the kept words, burned in with libass in Jost, and
saved as an `.srt` beside the video.
The caption font in `apps/desktop/resources/fonts` is Jost SemiBold (SIL OFL,
`OFL.txt`), converted from the `@fontsource/jost` Latin subsets.

## Licenses

A few files in `apps/desktop` are adapted from Diffusion Studio's editor and keep
their MPL-2.0 headers. The bundled ffmpeg is a GPL build; ClipCat is a personal
tool and isn't distributed.
