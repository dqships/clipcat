// Writes robots.txt, sitemap.xml, llms.txt and llms-full.txt into public/ before `next build`,
// with the production address in them. They're built, so git ignores them.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { llmsFullTxt, llmsTxt, robotsTxt, sitemapXml } from "../lib/markdown.mjs";
import { siteOrigin } from "../lib/site.mjs";

const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const origin = siteOrigin();
writeFileSync(join(pub, "robots.txt"), robotsTxt(origin));
writeFileSync(join(pub, "sitemap.xml"), sitemapXml(origin));
writeFileSync(join(pub, "llms.txt"), llmsTxt(origin));
writeFileSync(join(pub, "llms-full.txt"), llmsFullTxt(origin));
console.log(`wrote robots.txt, sitemap.xml, llms.txt and llms-full.txt for ${origin}`);
