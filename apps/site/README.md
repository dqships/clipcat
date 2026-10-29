# ClipCat's site

The marketing site: a Next.js app (Pages Router) whose pages are plain,
prerendered HTML with no JavaScript. Vercel serves it, and `proxy.ts` answers
`Accept: text/markdown`, and every `.md` address, with the page's Markdown.

| File | What it is |
| --- | --- |
| `lib/content.mjs` | Every page, as data. Edit the words here. |
| `lib/docs.generated.mjs` | The help pages at `/docs`, made from the repo's `docs/` folder by `scripts/docs.mjs`. Edit `docs/`, then run `npm run docs`; a test fails when this is out of date. It's committed because Vercel builds this folder on its own. |
| `lib/markdown.mjs` | Each page's Markdown, the structured data, `robots.txt`, `sitemap.xml`, `llms.txt` and `llms-full.txt` (every help page in one file). |
| `lib/negotiate.mjs`, `proxy.ts` | Markdown content negotiation, `.md` addresses, and a Markdown 404 for unknown pages. |
| `lib/site.mjs`, `next.config.mjs` | The production address and the security headers. |
| `pages/`, `components/` | The pages. The home page is laid out like ClipCat's timeline (DESIGN.md, "The site's timeline"). |
| `styles/site.css` | The site's styles, using `styles/tokens.css` (a copy of `design/tokens.css`; a test keeps them equal). |
| `scripts/text-files.mjs` | Writes `robots.txt`, `sitemap.xml`, `llms.txt` and `llms-full.txt` into `public/` before each build. |
| `scripts/og.mjs` | Renders `public/og.png`, the share card, from the home page's hero. |
| `scripts/vercel-ignore-build.mjs` | Vercel's `ignoreCommand`: skips a deployment when nothing in `apps/site/` or the root package files changed, and always skips previews on `claude/` and `codex/` branches. |

```sh
npm run dev            # http://localhost:3000
npm test               # copy lengths, Markdown, negotiation, headers, tokens
npm run test:server    # builds, then checks every served page against the launch checklist
npm run build && npm run og   # re-render the share card (needs Playwright)
```

The site lives at https://clipcat.followusai.com. The production address comes
from `SITE_URL`, then the address Vercel gives the project (its shortest custom
domain), then `https://clipcat.followusai.com`. The Vercel project uses `apps/site` as its root directory and skips a
build when nothing in it changed (the help pages count, since a change to `docs/` changes `lib/docs.generated.mjs`).
