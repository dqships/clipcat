import { Head, Html, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="preload" href="/fonts/jost-latin-400-normal.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/jost-latin-600-normal.woff2" as="font" type="font/woff2" crossOrigin="" />
        {/* Vercel Web Analytics. A plain tag, because the pages turn off Next's JavaScript, so <Analytics /> would never run. Vercel only serves this file on its deployments. */}
        {process.env.VERCEL_ENV === "production" && <script defer src="/_vercel/insights/script.js" />}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
