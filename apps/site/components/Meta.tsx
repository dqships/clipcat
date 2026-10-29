import Head from "next/head";
import { NOT_FOUND, OG, jsonLd, mdPath, url } from "../lib/markdown.mjs";
import { siteOrigin } from "../lib/site.mjs";
import type { Page } from "./types";

/** The head every page gets: title, description, canonical, the Markdown alternate and share cards. */
export function Meta({ page }: { page: Pick<Page, "path" | "title" | "description" | "updated"> }) {
  const origin = siteOrigin();
  const canonical = url(origin, page.path);
  const image = `${origin}${OG.path}`;
  const real = page.path !== NOT_FOUND.path;
  return (
    <Head>
      <meta name="viewport" content="width=device-width, initial-scale=1" key="viewport" />
      <title>{page.title}</title>
      <meta name="description" content={page.description} />
      {real && <link rel="canonical" href={canonical} />}
      {real && <link rel="alternate" type="text/markdown" href={mdPath(page.path)} />}
      <meta name="is-agentic-site-type" content="app" />
      <meta name="color-scheme" content="light dark" />
      <link rel="icon" href="/favicon.ico" sizes="32x32" />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="ClipCat" />
      <meta property="og:title" content={page.title} />
      <meta property="og:description" content={page.description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content={String(OG.width)} />
      <meta property="og:image:height" content={String(OG.height)} />
      <meta property="og:image:alt" content={OG.alt} />
      <meta property="og:locale" content="en_US" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={page.title} />
      <meta name="twitter:description" content={page.description} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:image:alt" content={OG.alt} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(page, origin) }} />
    </Head>
  );
}
