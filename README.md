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
| `native/parakeet` | `clipcat-parakeet`, a Swift helper that runs Parakeet TDT 0.6B v3 with FluidAudio (Apple Silicon) |
| `native/recorder` | `clipcat-recorder`, a Swift helper that records the screen with ScreenCaptureKit (macOS 15) |
| `scripts/` | `fetch-ffmpeg` (pinned static builds), `build-whisper` (whisper.cpp from a pinned commit), `build-parakeet` and `build-recorder` (the Swift helpers), `check-tokens` (no raw values in UI) |
| `apps/site` | Marketing site (coming later), deployed on its own by Vercel |

## Develop

```sh
npm install
npm run fetch:ffmpeg   # ffmpeg + ffprobe for this machine into vendor/
npm run fetch:cutout   # the subject cutout model (ISNet, 44 MB) into vendor/models/
npm run build:whisper  # whisper-cli into vendor/ (needs git, cmake and a C++ compiler)
npm run build:parakeet # Apple Silicon only: clipcat-parakeet into vendor/ (needs Xcode 16+)
npm run build:recorder # macOS only: clipcat-recorder into vendor/ (needs Xcode 16+)
npm run dev            # Vite + Electron
npm run check && npm test && npm run lint:tokens
npm run make           # installers in apps/desktop/out/make (set SKIP_SIGN=1 for unsigned)
```

Smoke test a packaged build: `CLIPCAT_SMOKE=1 <path to ClipCat binary>` prints one
JSON line and exits 0 when the UI drew and the bundled ffmpeg, whisper-cli,
(on Apple Silicon) clipcat-parakeet and (on macOS) clipcat-recorder ran.
Add `CLIPCAT_SMOKE_IMPORT=<video>` to also import, transcribe and analyse a file
(`CLIPCAT_MODEL=base` uses the small speech model).

Projects live in the app's data folder (`~/Library/Application Support/ClipCat/projects`
on macOS, `%APPDATA%\ClipCat\projects` on Windows); the speech model downloads
once into `models/` beside them.

On an Apple Silicon Mac (macOS 14 or later) speech is heard by NVIDIA's Parakeet
TDT 0.6B v3 on the Neural Engine, through FluidAudio: several times faster than
whisper, with tighter word times, in 25 European languages (it detects which).
Other languages, Windows and Intel Macs use whisper.cpp, which also takes over
if Parakeet can't run; `CLIPCAT_TRANSCRIBER=whisper` forces it. The project log
(`events.jsonl`) records which engine heard each recording, and why Parakeet was
passed over.

AI cuts use your own Claude Code: install it and run `claude auth login` once.
ClipCat finds `claude` on your login shell's PATH (or `CLIPCAT_CLAUDE_PATH`) and
gives it a single tool, `submit_analysis`, which runs inside the app; it gets no
file, shell or web access. Proposals are checked against the transcript and
nothing is cut until you accept it.

Codex works too: install the Codex CLI, run `codex login`, and pick Codex under
"Find cuts with" (or set `CLIPCAT_CODEX_PATH`). ClipCat runs `codex exec` in a
read-only sandbox in an empty temporary folder, with the prompt on stdin and
the answer held to a JSON schema; it is checked exactly like Claude's.

Or use the Claude API with your own key: pick "Claude API (your key)", paste a
key from console.anthropic.com (it is checked with one call, then stored
encrypted with the system keychain, never in the settings file or the window),
and choose Opus 5.5, Sonnet 5.5 or Haiku 5.5. The answer tool is the only tool
the model gets; a declined request falls back to Anthropic's recommended model.

The AI editor also takes one-off requests ("cut the part about pricing"), which
add proposals next to the ones waiting, and fixes misheard names: list the
names and terms you use, and "Fix transcript" corrects only the words it is
sure of, keeping their timing (hover a corrected word to see what was heard).
The same list is passed to whisper as a prompt when transcribing (Parakeet
takes no prompt, so "Fix transcript" is how names get fixed there).

Shorts come from the same AI editor: choose how many and how long (up to 30,
60 or 90 seconds) and "Make shorts" picks the moments that open with a hook and
stand on their own. Each becomes its own vertical project, listed under the
long video and in the library, that keeps the long edit's cuts and its waiting
suggestions; its recordings' prepared media are hard links to the long
video's, so a short takes no extra disk space. Deleting either one leaves the
other intact.

The vertical crop follows the speaker. After import, ClipCat samples a frame
every 2 seconds from the proxy and finds faces with MediaPipe's BlazeFace
short-range model, run on its WebAssembly runtime in a hidden window
(apps/ui/faces.html). Both ship with the app, so detection works offline and
the same on macOS and Windows. Each kept stretch is cropped around the median
face position in it, so the frame moves only at cuts. Set Shape to Vertical
9:16 to preview the crop, and untick "Follow the speaker" to place it by hand
per recording.

Punch-ins zoom the picture toward the speaker for a few seconds to give a line
weight. The AI editor suggests them alongside its cuts, or you can select words
in the transcript and press "Punch in". Each one snaps in, pushes in quickly
or creeps in slowly, and they are kept at least 10 seconds apart with 6
seconds of no zoom between them. They follow their words through later edits.
The export zooms with crop/scale and zoompan, aimed at the face inside the
frame's crop, and the preview shows the same zoom.

B-roll shows your own pictures and clips over the speaker while they keep
talking, full frame or picture in picture (a rectangle, square or circle in
any corner). Add them in the B-roll panel: ClipCat makes a light preview copy
and a few frames of each, and the AI editor looks at the frames and writes
what each one shows (you can correct it). From then on it suggests b-roll
where a line matches, or you can select words and pick one from "B-roll…".
The export overlays the original clip (or the picture) for its stretch, with
the window's corners masked, under the captions; the preview places it with
the same layout.

Motion slides are short animated cards (a section title, a list of steps, a
number) that the AI editor suggests where seeing the words helps, or that you
ask for by selecting words and pressing "Slide". Each has a brief (what it
says) and a look: ink on warm paper, paper on ink, or a label over the
video. The AI editor designs it in HTML and CSS with the app's palette, Jost
and spring; ClipCat renders stills of the design in a hidden window and sends
them back so the agent can check its work before the slide is saved. Every
animation is paused and stepped by the MotionKit runtime
(`window.motion.seek(t)`), so the preview runs the slide live at the
playhead and the export renders it frame by frame into a video with
transparency, once per design and shape. Editing the brief in the B-roll
panel has it designed again.

Sound effects come from a small library that ships with the app (a whoosh,
a pop, a ding, a riser and nine more), synthesized by `scripts/make-sfx.mjs`
so they are ClipCat's own. Each one says what it means, and the AI editor
reads those meanings to season the edit: at most one effect every 15 seconds,
never two within 1.5 seconds, each on the word it belongs to. You can land
one yourself by selecting words and picking from "Sound…", and set how loud
each plays in the Sound panel, where the library can be listened through.
Music goes under the whole video from any audio file: it loops to the
length, fades in and out, and dips while someone speaks (a sidechain
compressor in the export; the preview approximates it). The export places
each effect so its hit lands on the word, and mixes speech, effects and
music with a limiter on top.

The write-up is what goes with the video when it's posted. The AI editor
reads the edited transcript and writes chapters (each on the word it starts
with, so they follow the edit, at least 10 seconds apart, three or more on a
video over a minute), a short description and an article in Markdown in the
speaker's voice. Everything can be changed in the panel, and a chapter can be
started on any word from the transcript. "Copy description and chapters"
puts the description with a YouTube-style chapter list on the clipboard, the
article saves as a `.md` file, and every export carries the title and the
chapters in the MP4 itself.

The thumbnail starts from a frame: pause where you look your best and pick
"Use the frame at …". ClipCat grabs that frame from the original recording
and cuts you out of it, so big Jost text can sit behind you, over the frame,
the frame blurred, or a flat palette colour. The cutout is ISNet (the
quantized model IMG.LY ships in `@imgly/background-removal-node`, AGPL-3.0)
on ONNX Runtime's WebAssembly backend in a hidden window, so it runs offline
and the same on macOS and Windows; it takes a few seconds per frame.

Editing happens in the transcript: click a word to jump there, shift-click to
select a run, and press Delete to cut it (again to restore). Suggested cuts,
from the pause finder and from Claude, are accepted or rejected under the
preview. Every edit is undoable with Cmd/Ctrl+Z and redone with
Shift+Cmd/Ctrl+Z, and the preview plays the edit with the cuts skipped.

Takes can be recorded in ClipCat itself: Record in the library starts a new
project, and the camera icon in a project's title bar adds a take to it. Camera records
the webcam and microphone, Voice the microphone alone, and Screen a whole
display with the microphone and, if you like, the computer's sound. On macOS 15
the screen is recorded by `clipcat-recorder` (ScreenCaptureKit writing H.264
straight to a movie, with ClipCat's window left out); on Windows and older
Macs it goes through Chromium's screen capture, with the window kept out of the
picture by content protection and the computer's sound taken by loopback on
Windows. Camera and voice takes use MediaRecorder (H.264 in MP4 where Chromium
can, WebM otherwise), streamed to the main process a second at a time. When you
stop, the take is remuxed without re-encoding the picture (several sound tracks
are mixed into one so transcription hears them together), kept in
`Movies/ClipCat` (`Videos\ClipCat` on Windows), since it is the project's
source, and imported like any other video.

Claude Code, Codex and the Claude desktop app can drive ClipCat from outside
it. Settings (the gear in the library) adds ClipCat's MCP server to each
agent's config: `~/.claude.json`, `~/.codex/config.toml` or
`claude_desktop_config.json`. The entry runs ClipCat's own executable as Node
(`ELECTRON_RUN_AS_NODE=1`) on `dist/mcp.cjs`, a small bridge that pipes the
agent's stdio to a socket in the app's data folder (a named pipe on Windows),
so there is no port and no token. The tools read projects and the numbered
transcript, cut and restore words, decide proposals, take any edit op, start
the app's own AI passes and exports, and import recordings. Every change goes
through the same revision check as the editor, so nothing overwrites an edit
made in the window. A packaged ClipCat that isn't running is started by the
bridge, and entries are pointed at the current copy of the app on every launch.

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
saved as an `.srt` beside the video. The caption font in
`apps/desktop/resources/fonts` is Jost SemiBold (SIL OFL, `OFL.txt`), converted
from the `@fontsource/jost` Latin subsets.

To finish a cut in another editor, the Export panel also saves the edit as a
timeline of the original recordings: FCPXML 1.10 for Final Cut Pro (Resolve
opens it too), Final Cut 7 XML for Premiere Pro, or a CMX 3600 EDL. Each kept
stretch is snapped to whole frames at the recordings' rate (29.97 and 23.976
counted in 1001ths), at normal speed, with chapters as markers; captions,
punch-ins, b-roll and sound stay in ClipCat. Agents connected over MCP can
write the same files with `export_timeline`.

## Licenses

A few files in `apps/desktop` are adapted from Diffusion Studio's editor and keep
their MPL-2.0 headers. The bundled ffmpeg is a GPL build; ClipCat is a personal
tool and isn't distributed.

The face detector is MediaPipe Tasks Vision and its BlazeFace short-range model
(`apps/ui/src/faces/blaze_face_short_range.tflite`), both Apache-2.0.
