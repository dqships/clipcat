import { robotsTxt } from "../../lib/markdown.mjs";
import { siteOrigin } from "../../lib/site.mjs";

export const dynamic = "force-static";

export function GET() {
  return new Response(robotsTxt(siteOrigin()), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
