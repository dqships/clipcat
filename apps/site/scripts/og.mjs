// Renders public/og.png, the 1200×630 card shown when a page is shared, from
// the home page's own hero. Needs Playwright with Chromium; run it again when
// the brand or the headline changes, and commit the image.
//   npm run build && npm run og

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// Required rather than imported so a globally installed Playwright is found too.
const { chromium } = require("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4399;
const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: root, stdio: "ignore" });
for (let i = 0; i < 100; i++) {
  try {
    await fetch(`http://127.0.0.1:${port}/`);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, colorScheme: "light", bypassCSP: true });
await page.goto(`http://127.0.0.1:${port}/`);
// The card is the yellow plate alone: logo, kicker, headline and the mark.
await page.addStyleTag({
  content: `
    body { overflow: hidden; }
    .skip, .masthead__nav, .hero__lede, .downloads, .home > :not(.hero), .footer { display: none !important; }
    .hero { height: 566px; padding-block: 56px 0; }
    .hero__title { max-width: 640px; font-size: 96px; }
    .hero__mark { width: 470px; right: -40px; bottom: -150px; }
  `,
});
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(root, "public", "og.png") });
await browser.close();
server.kill();
console.log("wrote public/og.png");
