# Handoff — VNG extraction (hub side, Phase B NOT yet done)

**Date:** 2026-07-29
**This repo:** `variance-narrative-generator` — the hub, serves chiefeotool.com
**Companion repo:** `chiefeo-vng` — the extracted tool, **already live**
**Status:** VNG side complete and deployed. **This repo is unchanged so far.**

---

## Read this first

The Variance Narrative Generator has been extracted into its own repo and its
own Vercel project. That project is live. **Nothing in this repo has been
modified yet** — chiefeotool.com still serves VNG itself at `/vng` from the SPA,
exactly as before.

Phase B is the work described below: strip VNG out of this repo and proxy `/vng`
to the new project, the way `/orgen`, `/downdriller`, and `/chiefeoinspector`
already work.

> **VNG ≠ ORGEN.** The Variance Narrative Generator (`/vng`) and the Owner Report
> Generator (`/orgen`, repo `owner-report-generator`) are different tools. Never
> conflate them.

---

## Verified facts (checked, not assumed)

| Thing | Value |
| --- | --- |
| This repo's Vercel project | **`variance-narrative-generator`** → `https://www.chiefeotool.com` (confirmed via `vercel projects ls`, not inferred) |
| New GitHub repo | `GabrielBR408/chiefeo-vng` — **private** |
| New Vercel project | `chiefeo-vng` → `https://chiefeo-vng.vercel.app`, git-connected (every push auto-deploys) |
| VNG live URL today | `https://chiefeo-vng.vercel.app/vng` |
| `origin/main` here | `01e58e6` (PR #121) |
| Vercel scope | `gabrielbr408s-projects` |

Apex `chiefeotool.com` 308-redirects to `www.chiefeotool.com`.

### Live topology today

Served **directly by this project**: `/`, `/vng`, `/skills`, `/tos`, `/privacy`,
`/stacking`, `/utilities-forecaster`, `/analytics`, `/tools/*`, `/robots.txt`,
`/sitemap.xml`.

**Proxied out** (identified by a chained `x-vercel-id`, e.g. `sfo1:sfo1:sfo1::`):
`/orgen`, `/downdriller`, `/chiefeoinspector`.

`/`, `/vng`, `/skills`, `/tos`, `/privacy` all return the *same* `index.html`.
`src/main.jsx` picks the route at runtime.

---

## Phase B — what still needs doing here

### 1. Delete the VNG files (~150)

- `src/App.jsx`
- `src/components/` — all except `Footer.jsx`, `HomeLandingContent.jsx`,
  `LegalDocument.jsx`, `auth/AccountShell.jsx`. That's 22 components plus
  `uiFormat.js`.
- `src/hooks/` — all three
- `src/lib/enrich/`, `export/`, `extract/`, `narrative/`, `ocr/`, `plan/`,
  `variance/` — entire subtrees
- `src/lib/` loose files: `backupNotice`, `buildInfo`, `classify`,
  `clientGenerate`, `enrichmentDiagnostic`, `enrichmentStatus`, `fileKey`,
  `generateState`, `pipeline`, `previewNarrative`, `profiles`,
  `truncationNotice`, `uiControls`, `uploadRouting`
- `server/` — all four
- `api/generate.js`, `api/ocr.js` (and the `functions` block in `vercel.json`)
- `test/` — everything **except** `legalDoc.test.js` and `share.test.js`
- `tests/pdfGL.test.mjs`, `tests/pdfTable.test.mjs` (keep `stacking.smoke.mjs`)
- `scripts/style-controls-diagnostic.mjs`
- `docs/phase-19*.md`, `docs/diagnostics/`
- `public/images/og-vng.png` — **keep it**, the new repo's `og:image` points at
  `https://chiefeotool.com/images/og-vng.png`

**Keep:** `src/lib/share.js` (hub Share button only), `src/lib/legalDoc.js`,
`src/lib/track.js` (still used by the static tools).

### 2. Split five shared files

| File | What to do |
| --- | --- |
| `index.html` | **Highest risk item.** Its `<title>`, description, OG tags and `SoftwareApplication` JSON-LD are VNG's copy verbatim — that block now lives in `chiefeo-vng/index.html`. A hub-specific `<head>` must be **written**, not just trimmed. Leaving VNG's copy would misrepresent the homepage; deleting it without a replacement regresses homepage SEO. |
| `src/styles/app.css` | 1251 lines. VNG took 1–700, 974–1099, 1184–end. Hub must keep: the `:root`/reset/`.page` base (1–~34, **duplicated** — both need it), `.brand-logo` (47–64), `.site-footer*` (656–700, duplicated), then 701–842 legal, 843–895 hub, 896–973 skills, 1100–1183 homepage SEO. Section comments (`/* --- `) mark the boundaries. |
| `src/main.jsx` | Delete the `/vng` branch from `pickRoute()`. Keep `/skills`, `/tos`, `/privacy`, and the `Hub` fallback. |
| `vite.config.js` | Remove `generateEndpoint()` and the `server/generate.js` import. PWA manifest `start_url` should stop pointing at `/vng`. **Keep** `/^\/vng/` in `navigateFallbackDenylist` — it's now a proxied path and must never be answered by the SPA fallback. |
| `package.json` | Drop `@anthropic-ai/sdk`, `busboy`, `docx`, `exceljs`, `mammoth`, `pdfjs-dist`, `xlsx`. Keep `react-markdown` + `remark-gfm` (legal pages). Regenerate the lockfile. |

After this, `node --test` here should report **13 tests** (`legalDoc` + `share`).
It reports 952 today; 939 moved.

### 3. Add exactly two rewrites to `vercel.json`

**Do not rewrite the file.** Insert these two entries, and place them **above**
the catch-all `"/((?!api/|assets/).*)"` — Vercel matches top-down and the
catch-all would otherwise swallow them:

```json
{ "source": "/vng",        "destination": "https://chiefeo-vng.vercel.app/vng" },
{ "source": "/vng/:path*", "destination": "https://chiefeo-vng.vercel.app/vng/:path*" }
```

Note this is the **pass-through** shape (prefix preserved on both sides), which
differs from the `/orgen` and `/chiefeoinspector` entries. That is deliberate:
`chiefeo-vng` builds under a `/vng/` base, so its asset URLs are already
`/vng/assets/…` and its API is at `/vng/api/…`. Verified working against the live
deployment — `/vng/api/generate` returns 405 (method not allowed), not 404.

### 4. SEO gaps to close while you're in there

- **`/vng` is absent from `public/sitemap.xml`.** Defensible today because `/`
  *is* VNG's SEO surface; a real gap once the split lands.
- **There is no `/tools/vng` landing page**, unlike the other three tools
  (`public/tools/orgen.html`, `downdriller.html`, `chiefeoinspector.html`).
  Consider adding one for parity.

---

## Sequencing — this matters

The `/vng` rewrite points at `chiefeo-vng.vercel.app`. That project **is already
live**, so the ordering hazard is resolved — but the Phase B PR should still be
verified against the live proxy before merging, and **never** merged straight to
`main`.

Confirm after merge: `chiefeotool.com/vng` returns 200 with a chained
`x-vercel-id`, and `chiefeotool.com/vng/api/generate` returns 405 not 404.

---

## Open decisions

1. **35 unmerged remote branches.** All are 63–254 commits behind `main`, mostly
   1–2 commits deep, and almost all touch VNG files that are about to leave this
   repo. Triage before Phase B or they become unreplayable. Straddlers that touch
   shared files: `ux/pwa-icon-and-meta` (worst — `index.html`, `main.jsx`,
   `vite.config.js`, icons), `claude/vng-feedback-widget-50x0kb`,
   `claude/upbeat-thompson-cncfph` (adds `netlify.toml`).
2. **Homepage copy.** `src/components/HomeLandingContent.jsx` is VNG marketing
   copy sitting on the hub homepage, with "Try VNG Now" CTAs. Keep it (homepage
   sells VNG) or write hub-level copy?
3. **`deploy-pages.yml`** publishes a static GitHub Pages mirror of the VNG app
   via the `clientGenerate.js` no-server fallback. Only meaningful for VNG —
   move it to `chiefeo-vng` or retire it.
4. `.claude/launch.json` here has a `chiefeo-vng-preview` entry added for
   verification (runs `npm --prefix ../chiefeo-vng run preview`). Untracked local
   tooling; delete if unwanted.

## Already merged — do not re-do

`og-images-deploy`, `simplify-homepage-client-filter`, `feat/legal-pages`,
`feat/claude-api-disclosure` are all **merged** (0 commits ahead of `main`).
`beta-label-cleanup` has no remote branch. In particular
`ClaudeApiDisclosure.jsx` is live on `main` and imported by `App.jsx` — it is
not pending work.

## Environment constraints

- `gh` CLI is **not installed**. `git push` works via Windows Credential Manager.
- `git filter-repo` is **not installed**; `git subtree` exists but VNG spanned
  four top-level dirs, so history was not carried across. **This repo remains the
  historical record for all pre-split VNG work.**
- Vercel CLI is installed and authenticated as `gabrielbr408`.
- `vercel --prod` is blocked by the permission classifier here; deploy via git
  push (the projects are git-connected) or `vercel redeploy <url>`.
