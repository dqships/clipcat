import { Head, Html, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="preload" href="/fonts/jost-latin-400-normal.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/jost-latin-600-normal.woff2" as="font" type="font/woff2" crossOrigin="" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
