# ClipCat design system

Read this before building, revising or reviewing any screen in the app or on the site.
Every screen uses these tokens only. If something new is needed, add it here first,
then to `design/tokens.css` and `design/tokens.json`, then use it.

## The world: the cutting room

ClipCat lives in a mid-century film cutting room. Everything is made from the
same few things: black ink, warm paper, and yellow splice tape. Shapes are cut,
not drawn. A clip is a strip, a cut is a straight wedge, a selection is a strip
of tape. There are no gradients, no glass and no glows.

The logo follows the Logo Modernism tradition (Jens Müller): one geometric idea,
flat shapes, strong positive and negative space.

## Logo

The mark is a cat head made from a thick letter C. A wedge is cut out of the
right side, like trimming a clip, and two triangular ears sit on top. It is
built on a 100-unit grid: head circle r 32 at (50, 58), counter r 14, wedge
opening ±40°. The geometry is generated, so it stays exact.

| File | Use |
| --- | --- |
| `brand/logo/clipcat-mark-{ink,white,yellow}.svg` | Mark alone |
| `brand/logo/clipcat-lockup-{ink,white}.svg` | Mark plus wordmark, the default logo |
| `brand/logo/clipcat-wordmark-{ink,white}.svg` | Wordmark alone, Jost SemiBold outlined |
| `brand/icon/icon.icns` | macOS app icon (Electron `mac.icon`) |
| `brand/icon/icon.ico` | Windows app icon (Electron `win.icon`), 16 to 256 px |
| `brand/icon/icon.png` | 1024 px source PNG (Linux, generic) |
| `brand/icon/favicon.svg`, `favicon.ico` | Site favicon |
| `brand/icon/apple-touch-icon.png` | 180 px, square, for the site |
| `brand/icon/png/` | All rendered sizes |
| `apps/desktop/resources/dmg/background.png`, `@2x` | Mac installer window: paper, one line of ink, a strip of tape from ClipCat to Applications. Rendered from the tokens by `brand/scripts/render-dmg.mjs` |

Rules:

- Use the ink mark on light backgrounds and the white mark on dark ones. Use the
  yellow mark only on ink.
- Keep clear space around the mark equal to the width of one ear.
- Below 32 px use `clipcat-icon-tile-small.svg`. Its counter is opened up
  (r 15.5) so the C does not fill in.
- Do not redraw, outline, rotate, recolor outside these tokens, or add effects.

## Color

Yellow is splice tape. It marks the one thing that matters on a screen: the
main action, the selected clip, the playhead. It is never used for body text on
light backgrounds (contrast is too low). Text on yellow is always ink.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--color-background` | `#FAF8F3` | `#141310` | Page and window background |
| `--color-surface` | `#F1EEE6` | `#1E1C18` | Panels, timeline, inputs |
| `--color-surface-raised` | `#FFFFFF` | `#2A2721` | Menus, popovers, dialogs |
| `--color-text` | `#17150F` | `#F1EDE4` | Primary text and icons |
| `--color-text-muted` | `#6B665C` | `#A39E92` | Secondary text, labels |
| `--color-border` | `#DEDAD0` | `#33302A` | Hairlines, input borders |
| `--color-primary` | `#17150F` | `#F1EDE4` | Primary buttons (ink) |
| `--color-on-primary` | `#FAF8F3` | `#141310` | Text on primary |
| `--color-accent` | `#F2B705` | `#F2B705` | Splice tape: main action, selection, playhead |
| `--color-on-accent` | `#17150F` | `#17150F` | Text and icons on accent |
| `--color-danger` | `#C8361D` | `#F0674C` | Destructive actions, errors |

## Type

One family: **Jost** (Google Fonts, OFL), a Futura-style geometric sans.
Fallback: `"Jost", "Futura", "Century Gothic", system-ui, sans-serif`.
Weights: 400 regular, 500 medium, 600 semibold.

Command names, file paths and agent sessions (on the site, and in the
app's agent guide) are set in the system monospace, `--font-mono` (`ui-monospace, "SF Mono", Menlo, Consolas,
monospace`), at the size of the text around them. Nothing else uses it.

| Token | Size / line height | Use |
| --- | --- | --- |
| `--text-caption` | 12 / 16 | Timecodes, labels, metadata (tabular numbers) |
| `--text-body` | 14 / 20 | Default UI text |
| `--text-callout` | 17 / 24 | Panel titles, marketing body |
| `--text-title` | 22 / 28 | Dialog and section titles |
| `--text-display` | 32 / 36 | Page headings, marketing headlines |

Two more sizes exist for the marketing site only, and grow with the window:

| Token | Size / line height | Use |
| --- | --- | --- |
| `--text-poster` | 48 to 144 / 0.92 | The one poster line in the home page hero |
| `--text-headline` | 30 to 52 / 1.04 | Section headlines on the site |

Large type is set tighter with `--tracking-tight` (−0.035 em). Small uppercase
labels get `--tracking-caps` (0.12 em).

Timecodes always use `font-variant-numeric: tabular-nums`.

## Spacing

`--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-5` 24,
`--space-6` 32. Layout steps (marketing site and large app regions only):
`--space-7` 48, `--space-8` 64, `--space-9` 96.

One breakpoint: 720 px, below which the site switches to its phone layout. Media
queries can't read custom properties, so it is written out as
`@media (max-width: 720px)`.

## The site's timeline

The marketing site is laid out like the editor's timeline: each section is a
track, with its name in a `--track-head` (88 px) column on the left and its
content as clips on the lane. Lanes use `--color-surface`, clips
`--color-surface-raised` with a hairline border, and cuts are splice tape
(`--color-accent`). The home page opens on a full-bleed accent plate with the
mark blown up and cropped off its edge. On a phone the track names shrink to
their short label and clips stack.

## The editor's panels

The preview sits still in the middle of the editor and never scrolls; the
picture shrinks to the room it has. The transcript and the controls are
panels around it. Each panel's title row has three ghost icon buttons
(Lucide `panel-left`, `panel-bottom`, `panel-right`) that dock it on the
left, at the bottom or on the right; the current one is filled with splice
tape. Two panels in one dock split it: stacked in a side dock, side by side
at the bottom, transcript first. Panels sit flat on the background.

Between areas is a `--space-5` gap with a 1 px `--color-border` hairline down
its middle. It is the resize handle: on hover, focus or drag it becomes a
`--space-1` strip of `--color-accent`. Arrow keys move it too. No panel or
the preview gets narrower or shorter than `--panel-min` (240 px). The layout
is remembered for every project.

## Shape and depth

- Radius: `--radius-control` 4 px (buttons, inputs, clips), `--radius-panel` 8 px
  (panels, menus, dialogs). App icon tiles use the platform shape.
- Shadows: `--shadow-raised` for menus and popovers, `--shadow-overlay` for
  dialogs. Panels sit flat and are separated by `--color-border` hairlines.
- Buttons are 32 px tall, padding 0 12 px, `--text-body` at 500, radius control.
  - Accent: accent fill, on-accent text. One per screen, for the main action
    (Export, Render).
  - Primary: primary fill, on-primary text.
  - Secondary: transparent, 1 px border, text color.
  - Ghost: transparent, no border, for toolbars.
- Inputs are 32 px tall, surface fill, 1 px border, radius control. Focus shows a
  2 px accent ring (`--focus-ring`).

## Icons

The app is Electron on both Mac and Windows, and SF Symbols can't ship on
Windows, so the UI uses **Lucide** only: 24 px grid, stroke width 1.75, round caps
and joins, drawn at 16 or 20 px. That matches SF Symbols regular weight closely.
Never mix in another icon library. Never use the sparkles icon.

## Motion

One spring everywhere: mass 1, stiffness 380, damping 32 (damping ratio 0.82, a
1% overshoot), settling in about 420 ms. In CSS use `--motion-spring` with
`--motion-duration` (420 ms). In JS spring libraries use the same three numbers.
Respect `prefers-reduced-motion` by switching to an instant change.

## Illustration and generated assets

Try to build simple assets in code first. Generate only what code can't match,
using the ClipCat mark as the reference image and this exact prompt. Change only
the scene.

> Flat mid-century modernist illustration in the Logo Modernism tradition. Built
> from geometric shapes: circles, triangles and straight cuts. Two-color print
> look in ink black (#17150F) and splice-tape yellow (#F2B705) on warm paper
> (#FAF8F3). No gradients, no outlines, no texture, no text. Strong positive and
> negative space, centered composition with generous margins. The character is
> the ClipCat mark: a cat head formed from a thick letter C with a wedge cut out
> of its right side and two triangular ears. Scene: {scene}.

Keep the same character and style in every image. No stock photos.
