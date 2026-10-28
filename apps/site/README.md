# ClipCat's site

The marketing site: plain HTML and Markdown built from `content.mjs`, with no
JavaScript on the pages and no dependencies. Vercel serves `dist/`, and
`middleware.js` answers `Accept: text/markdown` with each page's Markdown at the
same URL.

| File | What it is |
| --- | --- |
| `content.mjs` | Every page, as data. Edit the words here. |
| `render.mjs` | The HTML and Markdown for a page, plus `robots.txt`, `sitemap.xml` and `llms.txt`. |
| `build.mjs` | Writes `dist/`. |
| `negotiate.mjs`, `middleware.js` | Markdown content negotiation, and a Markdown 404 for unknown pages. |
| `vercel.json` | Build settings, clean URLs and the security headers. |
| `styles/site.css` | The site's styles, using `static/tokens.css` (a copy of `design/tokens.css`; a test keeps them equal). |
| `scripts/og.mjs` | Renders `static/og.png`, the share card, from the home page. |

```sh
node build.mjs            # build dist/
node serve.mjs            # serve it like Vercel on http://127.0.0.1:4322
npm test                  # the launch checklist, as tests
node scripts/og.mjs       # re-render the share card (needs Playwright)
```

The production address comes from `SITE_URL`, or the address Vercel gives the
project. The Vercel project uses `apps/site` as its root directory and skips a
build when nothing in it changed.
