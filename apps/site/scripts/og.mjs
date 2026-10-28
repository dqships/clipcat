// Renders static/og.png, the 1200×630 card shown when a page is shared, from
// the site's own stylesheet and logo. Needs Playwright with Chromium; run it
// again when the brand or tagline changes, and commit the image.
//   node build.mjs && node scripts/og.mjs

import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { serve } from "../serve.mjs";

// Required rather than imported so a globally installed Playwright is found too.
const { chromium } = createRequire(import.meta.url)("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = await serve(0);
const { port } = server.address();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, colorScheme: "light", bypassCSP: true });
await page.goto(`http://127.0.0.1:${port}/`);
// The card is the home page's own hero, laid out at card size.
await page.addStyleTag({
  content: `
    body { overflow: hidden; }
    .masthead, .section, .updated, .footer, .downloads, .downloads__note, .hero__figure figcaption, .skip { display: none !important; }
    main.wrap { max-width: none; height: 630px; padding: 64px; display: grid; align-content: center; }
    .hero { padding: 0; gap: 48px; grid-template-columns: 1fr 1fr; }
    .hero h1 { font-size: 44px; line-height: 50px; }
    .hero__text::before { content: ""; display: block; height: 48px; background: url(/brand/clipcat-lockup-ink.svg) left center / contain no-repeat; }
  `,
});
await page.evaluate(() => {
  document.querySelector(".lede").textContent = "A free desktop editor for Mac and Windows. It transcribes on your computer and cuts with your own Claude or Codex.";
});
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(root, "static", "og.png") });
await browser.close();
server.close();
console.log("wrote static/og.png");
