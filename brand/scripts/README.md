# Brand asset generator

The ClipCat mark is generated from exact geometry (`geom.py`), so never edit the SVGs by hand.

```bash
pip install fonttools uharfbuzz pillow
# Jost variable font from Google Fonts (OFL)
JOST_TTF=/path/to/Jost[wght].ttf python3 build.py   # writes brand/logo/*.svg and brand/icon/*.svg
node render.cjs                                     # renders brand/icon/png/* with Playwright
python3 pack.py                                     # packs icon.icns, icon.ico, favicon.ico, icon.png
```

The site serves copies from `apps/site/public/`: `favicon.ico`, `favicon.svg` and `apple-touch-icon.png` as they are, and `png/web-{48,96,192,512}.png` as `icon-{size}.png`. Copy them over after regenerating.
