import type { Metadata } from "next";
import { NOT_FOUND, OG, mdPath, url } from "./markdown.mjs";
import { siteOrigin } from "./site.mjs";

type Page = { path: string; title: string; description: string };

/** The head every page gets: title, description, canonical, the Markdown alternate and share cards. */
export function pageMetadata(page: Page): Metadata {
  const origin = siteOrigin();
  const canonical = url(origin, page.path);
  const image = { url: `${origin}${OG.path}`, width: OG.width, height: OG.height, alt: OG.alt };
  const real = page.path !== NOT_FOUND.path;
  return {
    metadataBase: new URL(origin),
    title: page.title,
    description: page.description,
    alternates: real ? { canonical, types: { "text/markdown": mdPath(page.path) } } : undefined,
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "32x32" },
        { url: "/favicon.svg", type: "image/svg+xml" },
      ],
      apple: "/apple-touch-icon.png",
    },
    openGraph: {
      type: "website",
      siteName: "ClipCat",
      title: page.title,
      description: page.description,
      url: canonical,
      images: [image],
      locale: "en_US",
    },
    twitter: { card: "summary_large_image", title: page.title, description: page.description, images: [image] },
    other: { "is-agentic-site-type": "app" },
  };
}
