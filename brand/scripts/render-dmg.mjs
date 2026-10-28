// Renders the Mac installer window's background (apps/desktop/resources/dmg/background.png and @2x)
// from design/tokens.json and the bundled Jost SemiBold. The window holds two icons, ClipCat and
// Applications; their spots come from apps/desktop/resources/dmg/layout.json, which forge.config.js
// reads too, so the tape always lands between them. Run with Playwright available: node brand/scripts/render-dmg.mjs

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "apps", "desktop", "resources", "dmg");
const L = JSON.parse(readFileSync(join(out, "layout.json"), "utf8"));
const t = JSON.parse(readFileSync(join(root, "design", "tokens.json"), "utf8")).light;
const jost = readFileSync(join(root, "apps", "desktop", "resources", "fonts", "Jost-SemiBold-latin.ttf")).toString("base64");
const px = (token) => parseFloat(t[token]);

// Splice tape from just past the ClipCat icon to just before Applications, its end cut into a wedge.
const gap = px("space-5");
const x0 = L.app.x + L.iconSize / 2 + gap;
const x1 = L.applications.x - L.iconSize / 2 - gap;
const y = L.app.y;
const half = px("space-3");
const tip = px("space-5");
const notch = px("space-2");
const tape = [
  [x0, y - half],
  [x1 - tip, y - half],
  [x1, y],
  [x1 - tip, y + half],
  [x0, y + half],
  [x0 + notch, y],
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}">
  <rect width="100%" height="100%" fill="${t["color-background"]}"/>
  <text x="${L.width / 2}" y="${L.captionY}" text-anchor="middle" font-family="Jost" font-weight="600"
    font-size="${px("text-callout")}" fill="${t["color-text"]}">Drag ClipCat into Applications</text>
  <polygon points="${tape.map((p) => p.join(",")).join(" ")}" fill="${t["color-accent"]}"/>
</svg>`;

const browser = await chromium.launch();
for (const [scale, name] of [
  [1, "background.png"],
  [2, "background@2x.png"],
]) {
  const page = await browser.newPage({ viewport: { width: L.width, height: L.height }, deviceScaleFactor: scale });
  await page.setContent(
    `<style>@font-face{font-family:Jost;font-weight:600;src:url(data:font/ttf;base64,${jost})}html,body{margin:0}svg{display:block}</style>${svg}`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out, name) });
  await page.close();
}
await browser.close();
