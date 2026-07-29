# SEO package integration — notes for review

Integration of `chiefeotool_seo_package` (schema markup, meta/OG tags, 4 landing
pages, practitioner byline, sitemap) into this repo. Everything is additive; no
tool logic, existing route, or the auth layer was changed.

## The structural constraint

`DEPLOYMENT_CHECKLIST.md` maps each tool's `<head>` block to
`chiefeotool.com/orgen`, `/downdriller`, and `/chiefeoinspector`. Those three
paths are **not pages in this repo** — `vercel.json` rewrites proxy them to
three separate Vercel projects, which serve their own HTML. This repo can never
inject a `<title>`, meta tag, or JSON-LD block into them.

So the three tools' meta + schema + landing copy live on new static pages here
instead:

| Package file | Checklist target | Where it actually went | Why |
|---|---|---|---|
| `landing_page_vng.md` + VNG meta/schema | homepage | `index.html` head + `src/components/HomeLandingContent.jsx` (rendered by the hub) | Homepage is served by this repo — direct mapping |
| `landing_page_orgen.md` + block 2 | `/orgen` | `public/tools/orgen.html` → `/tools/orgen` | `/orgen` is a proxy to another Vercel project |
| `landing_page_driller.md` + block 3 | `/downdriller` | `public/tools/downdriller.html` → `/tools/downdriller` | same |
| `landing_page_inspector.md` + block 4 | `/chiefeoinspector` | `public/tools/chiefeoinspector.html` → `/tools/chiefeoinspector` | same |
| `practitioner_byline.md` | About page / footer | Foot of the homepage + foot of all three `/tools/*` pages | No About page exists; the hub is the site's front door |
| `sitemap.xml` | site root | `public/sitemap.xml` → `/sitemap.xml` | Copied verbatim |
| `readme_gl_driller.md`, `readme_inspector.md` | other GitHub repos | **not applied** | Out of scope for this repo |

Each `/tools/*` page's CTA links through to the real tool (`/orgen` etc.), so
the proxied apps stay the destination — these pages are the crawlable front door
for tools whose own HTML this repo doesn't control.

## Open items for review

1. **Homepage title/OG identity changed.** `index.html` previously carried the
   hub identity ("ChiefEO Tool") with a comment explaining that choice, because
   one `index.html` serves `/`, `/vng` and `/skills`. The checklist maps VNG's
   block to the homepage, so the title is now
   `VNG — Variance Narrative Generator | ChiefEO`. If the hub identity should
   win, revert just that title/description/OG copy — the JSON-LD can stay.
2. **`"price": "0"`** is the package's assumption in all four schema blocks.
   Confirm before this ships; inaccurate free-price schema is a Rich Results
   violation risk.
3. **Missing image assets.** The package points `og:image`, `twitter:image` and
   schema `image` at `/images/<tool>-screenshot.png`. `public/images/` does not
   exist and no screenshots are committed, so those fields were omitted rather
   than left pointing at 404s. On the homepage the existing working
   `og:image` (`/icons/icon-512.png`) was kept. Once real screenshots land, add
   the image fields back and switch `twitter:card` to `summary_large_image`
   (it's `summary` now because only a square icon exists).
4. **One FAQ item dropped from the VNG copy.** The package's "Is this still
   labeled a prototype? No — VNG is a stable, production tool" answer directly
   contradicts the hub's own "Variance Narrative Generator (Beta)" button label
   on the same page. Either relabel the button or add the FAQ item back — I
   didn't change the button, since that's live UI copy, not SEO content.
5. **Sitemap is verbatim.** It lists `/`, `/orgen`, `/downdriller`,
   `/chiefeoinspector` only, per the checklist's "upload as-is". The new
   `/tools/*` pages are not in it (they're reachable via footer links from the
   homepage). Worth adding three `<url>` entries if you want them crawled
   directly. Submit the sitemap in Google Search Console after deploy.
6. **GitHub token.** `DEPLOYMENT_CHECKLIST.md` opens with a warning that a
   personal access token was pasted into the chat session that generated the
   package, and should be rotated. Nothing in this branch uses or contains a
   token — flagging it because the checklist raises it.
