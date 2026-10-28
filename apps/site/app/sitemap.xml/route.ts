import { sitemapXml } from "../../lib/markdown.mjs";
import { siteOrigin } from "../../lib/site.mjs";

export const dynamic = "force-static";

export function GET() {
  return new Response(sitemapXml(siteOrigin()), { headers: { "content-type": "application/xml; charset=utf-8" } });
}
