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
| `packages/ipc` | The typed contract between main and UI (zod schemas) |
| `design/` | Design tokens generated from DESIGN.md |
| `brand/` | Logo, app icons and their generator |
| `scripts/` | `fetch-ffmpeg` (pinned static builds), `check-tokens` (no raw values in UI) |
| `apps/site` | Marketing site (coming later), deployed on its own by Vercel |

## Develop

```sh
npm install
npm run fetch:ffmpeg   # ffmpeg + ffprobe for this machine into vendor/
npm run dev            # Vite + Electron
npm run check && npm test && npm run lint:tokens
npm run make           # installers in apps/desktop/out/make (set SKIP_SIGN=1 for unsigned)
```

Smoke test a packaged build: `CLIPCAT_SMOKE=1 <path to ClipCat binary>` prints one
JSON line and exits 0 when the UI drew and the bundled ffmpeg ran.

## Licenses

A few files in `apps/desktop` are adapted from Diffusion Studio's editor and keep
their MPL-2.0 headers. The bundled ffmpeg is a GPL build; ClipCat is a personal
tool and isn't distributed.
