# Brand asset generator

The ClipCat mark is generated from exact geometry (`geom.py`), so never edit the SVGs by hand.

```bash
pip install fonttools uharfbuzz pillow
# Jost variable font from Google Fonts (OFL)
JOST_TTF=/path/to/Jost[wght].ttf python3 build.py   # writes brand/logo/*.svg and brand/icon/*.svg
node render.js                                      # renders brand/icon/png/* with Playwright
python3 pack.py                                     # packs icon.icns, icon.ico, favicon.ico, icon.png
```

The Mac installer window's background is rendered from the design tokens:

```bash
node render-dmg.mjs   # writes apps/desktop/resources/dmg/background.png and @2x, laid out by layout.json there
```
