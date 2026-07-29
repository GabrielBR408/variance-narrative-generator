# Handoff — VNG extraction Phase B + hub cleanup (COMPLETE, one item outstanding)

**Date:** 2026-07-29
**This repo:** `variance-narrative-generator` — the hub, serves chiefeotool.com
**Companion repo:** `chiefeo-vng` — the extracted tool (**not touched by this work**)
**Predecessor doc:** `VNG-EXTRACTION-HANDOFF.md` (the Phase B work order — now executed)

> **VNG ≠ ORGEN.** The Variance Narrative Generator (`/vng`) and the Owner Report
> Generator (`/orgen`, repo `owner-report-generator`) are different tools. Never
> conflate them.

---

## Status in one line

Phase B is **done, merged, and verified live.** The hub cleanup follow-ups are
**done and merged but NOT verified live.** One task remains untouched: archiving
and deleting 36 stale remote branches.

---

## What shipped

| PR | Branch | Commit | What |
| --- | --- | --- | --- |
| #123 | `feat/vng-extraction-hub-side` | `e3479c3` (merge `f4d4f93`) | Phase B: delete in-repo VNG, proxy `/vng` |
| (number not captured) | `chore/hub-cleanup-post-vng` | `b4097ce` | Post-extraction cleanup (items 1, 3, 4, 5 below) |

---

## Verified facts (checked, not assumed)

| Thing | Value |
| --- | --- |
| `origin/main` before this work | `568c7b8` |
| Phase B merge commit | `f4d4f93` |
| `/vng` live | **200**, chained `x-vercel-id` (`sfo1:sfo1:sfo1::`) → proxy confirmed |
| `/vng/api/generate` | **405**, not 404 → generation routed correctly |
| `/vng` served content | chiefeo-vng's build — title `VNG — Variance Narrative Generator`, assets at `/vng/assets/index-*.js` (the `/vng/` base prefix the hub build never emits) |
| Hub `<head>` live | New hub title, canonical, `WebSite` + `Organization` JSON-LD, no `SoftwareApplication` |
| `/skills`, `/tos`, `/privacy` | 200 / 200 / 200 |
| `node --test` | **952 → 13** (`legalDoc` + `share`) |
| `npm run build` | Clean. Main chunk 400 kB → the pre-existing >500 kB advisory is **gone** |
| `src/styles/app.css` | 1251 → 516 lines (Phase B) → 450 lines (after cleanup) |
| npm packages removed | 135 |

---

## Phase B — what was done

### Deleted (~150 files)

`src/App.jsx`; 22 components + `uiFormat.js`; all three `src/hooks/`; the
`enrich/ export/ extract/ narrative/ ocr/ plan/ variance/` subtrees; 14 loose
`src/lib` files; `server/` (4); `api/` (2); `scripts/style-controls-diagnostic.mjs`;
`docs/phase-19*.md`; `docs/diagnostics/`; every `test/` file except
`legalDoc.test.js` and `share.test.js`; `tests/pdfGL.test.mjs` and
`tests/pdfTable.test.mjs`.

**Kept:** `src/lib/{share,legalDoc,track}.js`, `tests/stacking.smoke.mjs`,
`docs/seo-integration-notes.md`, `scripts/generate-icons.mjs`, and
`public/images/og-vng.png` (chiefeo-vng's `og:image` points at it).

### The five shared files

- **`index.html`** — VNG's title/description/OG/`SoftwareApplication` block moved
  with the app. A hub `<head>` was **written**: hub title + description covering
  all six tools, matching OG/Twitter tags, `<link rel="canonical">`, and
  `WebSite` + `Organization` JSON-LD in a `@graph`. De-identified — no Person
  block. The `Golden Real Estate Ventures and Exchanges LLC` Organization is
  retained because it was already in the original head and appears publicly in
  `Footer.jsx` and both legal documents.
- **`src/styles/app.css`** — split on the predecessor doc's line ranges.
- **`src/main.jsx`** — `/vng` branch and `App` import removed.
- **`vite.config.js`** — `generateEndpoint()` and the `server/generate.js` import
  removed; PWA `start_url` moved off `/vng` to the hub root (an installed PWA
  starting at `/vng` would leave its own scope on first paint).
  **`navigateFallbackDenylist` still contains `/^\/vng/`** and is now
  load-bearing — the SPA has no `/vng` route to fall back to.
- **`package.json`** — dropped `@anthropic-ai/sdk`, `busboy`, `docx`, `exceljs`,
  `mammoth`, `pdfjs-dist`, `xlsx`. Kept `react-markdown` + `remark-gfm` for the
  legal pages. Lockfile regenerated.

### `vercel.json`

Two rewrites added **above** the catch-all (Vercel matches top-down):

```json
{ "source": "/vng",        "destination": "https://chiefeo-vng.vercel.app/vng" },
{ "source": "/vng/:path*", "destination": "https://chiefeo-vng.vercel.app/vng/:path*" }
```

Pass-through shape (prefix preserved both sides) because chiefeo-vng builds under
a `/vng/` base.

---

## Two deliberate deviations from the original work order

Both were judgment calls. Flagging them so nobody reads the predecessor doc and
assumes it was followed to the letter.

### 1. The app.css "duplicated base" list was incomplete — this was a real bug

The work order said the hub keeps lines 1–34, 47–64, 656–700, and 701–1183 minus
974–1099. Applied literally, **`/skills` and both legal pages rendered
unstyled.** They are written in the `.workflow` / `.step` / `.step--source` /
`.step-head` / `.step-eyebrow` / `.card` / `.card--primary` / `.card-label` /
`.card-sub` / `.export-btn` / `.back-to-hub` vocabulary, all of which lived in
the VNG range (original lines 35–45, 78–110, 371–377).

Those rules were carried into the hub's duplicated-base block; the VNG-only
variants (`.step--generate`, `.step-title`, `.export-actions`, …) stayed behind.
Line 655 was taken rather than 656 so the footer section keeps its own comment.

Verified by **computed style in a real browser**, not by eye. `.hub` was never
defined in the original stylesheet either — it's a bare hook class, not a
regression.

### 2. `vercel.json`'s `functions` block was removed

The task brief said "change nothing else in that file"; the work order (line 70)
said to remove it alongside the `api/` handlers. The work order won — a
`functions` block pointing at deleted files **fails the Vercel build outright.**

---

## Hub cleanup (second PR) — what was done

1. **Retired `deploy-pages.yml`.** It published a static GitHub Pages mirror that
   only made sense for VNG — it depended on the `clientGenerate.js` no-server
   fallback, which left with the app. It still fired on every push to `main`.
   The stale `VITE_BASE` comment in `vite.config.js` was corrected; the env
   override itself stays, so a sub-path deploy remains possible.

2. **Moved the VNG marketing copy off the homepage.**
   `src/components/HomeLandingContent.jsx` (deleted) put VNG's landing page —
   hero, features, FAQ, worked example, two "Try VNG Now" CTAs — directly on the
   hub, because pre-split VNG had no URL of its own separate from `/`. The copy
   was **relocated, not rewritten**, to `public/tools/vng.html`, plus the
   "Who this is for" / "What it solves" sections the other three landing pages
   have.

   > **Load-bearing detail:** that component also held the nav linking to the
   > `/tools/*` pages, with a comment explaining it existed so those pages aren't
   > orphaned. Deleting the component wholesale would have cost all three landing
   > pages their only internal links. That nav was kept, renamed
   > `.hub-tool-links`, and `/tools/vng` added to it.

3. **Closed the SEO gaps.** `/vng` and `/tools/vng` added to
   `public/sitemap.xml`; a `/tools/vng` → `/tools/vng.html` rewrite added
   alongside the existing three; VNG cross-linked from `orgen.html`,
   `downdriller.html`, and `chiefeoinspector.html`.

4. **Gave the hub a real link-preview card.** `og:image` had been pointed at the
   square app icon with `twitter:card: summary`, because no wide hub card
   existed. Added `public/images/og-hub.png` (1200×630, styled to match the
   per-tool cards) and restored `summary_large_image` with explicit
   width/height/alt.

Build clean, 13 tests passing, and `/`, `/skills`, `/tos`, `/privacy` and the new
`/tools/vng` all verified rendering locally with **zero console errors**.

---

## ⚠️ OUTSTANDING — the only remaining task

### Archive + delete 36 stale remote branches

**Not started. No tags created, no branches touched.** Blocked mid-session by a
tooling outage (the permission classifier for shell/network tools went down and
did not recover), not by anything about the repo.

**Decision already made:** archive each branch as a tag first, then delete —
but only branches whose last commit predates **2026-07-22** (one week before
2026-07-29).

That cutoff splits the list cleanly: **all 36 unmerged branches are older; all 8
branches from within the week are already fully merged (0 unique commits).**
So the 8 recent ones stay, and nothing with unmerged work is lost — it becomes a
tag.

#### The 36 to archive + delete

`unique` = commits not in `main`.

| Branch | Last commit | unique |
| --- | --- | --- |
| `claude/pensive-carson-6e629t` | 2026-06-14 | 1 |
| `claude/keen-davinci-etou9b` | 2026-06-16 | 1 |
| `claude/phase-20a-2-gl-commentary-polish` | 2026-06-16 | 1 |
| `claude/upbeat-thompson-cncfph` | 2026-06-16 | 2 |
| `claude/affectionate-cray-p9i14k` | 2026-06-17 | 1 |
| `claude/happy-edison-e7uwc0` | 2026-06-17 | 1 |
| `claude/keen-edison-k5nc7p` | 2026-06-17 | 1 |
| `claude/nq-2b-reviewed-notes` | 2026-06-17 | 1 |
| `claude/nq-3a-commentary-planning-layer` | 2026-06-17 | 1 |
| `claude/nq-3b-sections-consume-plan` | 2026-06-17 | 1 |
| `claude/nq-3c-context-notes` | 2026-06-17 | 1 |
| `claude/nq4b1b-consume-prepared-evidence` | 2026-06-17 | 1 |
| `claude/stoic-bardeen-k32g33` | 2026-06-17 | 2 |
| `claude/eager-lamport-mirkza` | 2026-06-18 | 1 |
| `claude/funny-curie-ehzyxw` | 2026-06-18 | 1 |
| `claude/nq4c1-account-resolution` | 2026-06-18 | 1 |
| `claude/sharp-gauss-hurqho` | 2026-06-18 | 2 |
| `claude/bold-cannon-ttnzmj` | 2026-06-19 | 1 |
| `claude/enrichment-status-fix-a` | 2026-06-19 | 2 |
| `claude/enrichment-status-partial` | 2026-06-19 | 1 |
| `claude/peaceful-cori-xkvecv` | 2026-06-19 | 1 |
| `claude/section-driven-variance-direction` | 2026-06-19 | 2 |
| `claude/trusting-carson-33hvpp` | 2026-06-19 | 3 |
| `cleanup/step-1-dead-code` | 2026-06-19 | 1 |
| `cleanup/step-2-shared-regexes` | 2026-06-19 | 1 |
| `cleanup/step-3-shared-constants` | 2026-06-19 | 1 |
| `cleanup/step-4-detect-columns` | 2026-06-19 | 1 |
| `cleanup/step-5-decompose` | 2026-06-19 | 3 |
| `feature/style-controls` | 2026-06-19 | 1 |
| `ux/pwa-icon-and-meta` | 2026-06-19 | 1 |
| `claude/vng-minimal-default-layout-rd77qw` | 2026-06-21 | 1 |
| `claude/amazing-goodall-h9rkjx` | 2026-06-23 | 1 |
| `claude/budget-file-usage-diagnostic-f3ngb5` | 2026-06-23 | 2 |
| `claude/hero-text-main-page-fh2d6g` | 2026-06-23 | 2 |
| `claude/practical-goodall-ld762n` | 2026-06-23 | 4 |
| `claude/vng-feedback-widget-50x0kb` | 2026-07-09 | 1 |

Nearly all of these touch VNG files that no longer exist in this repo, so
replaying them was already impractical. The straddlers that touch files still
present: `ux/pwa-icon-and-meta` (`index.html`, `main.jsx`, `vite.config.js`,
icons — worst), `claude/vng-feedback-widget-50x0kb`, and
`claude/upbeat-thompson-cncfph` (adds `netlify.toml`).

#### The 8 to keep (all already merged, 0 unique commits)

`add-skills-page`, `claude/utilities-forecaster-beta`,
`feat/claude-api-disclosure`, `feat/legal-pages`, `docs/vng-extraction-handoff`,
`feat/vng-extraction-hub-side`, `og-images-deploy`,
`simplify-homepage-client-filter` — plus `chore/hub-cleanup-post-vng`.

These are safe to delete at any time (their commits are in `main`); they're
retained only because they fall inside the one-week window.

#### Recovering an archived branch

```
git checkout -b <name> archive/<name>
```

---

## Also unverified

The **hub cleanup deploy was never checked live** — the outage hit before
verification. Run:

```
curl -so /dev/null -w 'tools/vng: %{http_code}\n' https://www.chiefeotool.com/tools/vng
curl -so /dev/null -w 'og-hub:    %{http_code}\n' https://www.chiefeotool.com/images/og-hub.png
```

Both should be **200**. If `/tools/vng` 404s, the `/tools/vng` rewrite in
`vercel.json` didn't take.

Cosmetic, worth an eye at some point: `/skills`, `/tos` and `/privacy` are still
absent from `sitemap.xml`. Out of scope for this work; noted, not acted on.

---

## Environment constraints (unchanged, all still true)

- **No GitHub token; `gh` CLI is not installed.** Push works via Windows
  Credential Manager. PRs must be opened/merged by hand from the compare URL.
- **Never commit to `main`.** This environment has silently reverted the branch
  mid-session — run `git branch --show-current` immediately before every commit.
  Both commits in this work were guarded with a shell `test` so they could not
  run from the wrong branch.
- `vercel --prod` is **blocked** by the permission classifier. Deploy via git
  push (projects are git-connected) or `vercel redeploy <url>`.
- `git filter-repo` is not installed. VNG history was **not** carried across to
  `chiefeo-vng` — **this repo remains the historical record for all pre-split
  VNG work.** That is another reason the archive tags matter.
- Screenshots via the in-app browser require the Browser pane to be displayed;
  when it isn't, verify with the accessibility tree plus computed CSS instead
  (which is the stronger check for a stylesheet split anyway).

---

## The branch-archival script

Reproduced here so it survives temp-directory cleanup. Safety ordering: every
tip is tagged **and the tags are confirmed present on the remote** before any
branch is deleted; if a tag push fails, nothing is deleted. Run from `main`
(the script skips whatever branch you're on).

Preview with `DRY_RUN=1`.

```bash
#!/usr/bin/env bash
set -euo pipefail

CUTOFF="2026-07-22"
REMOTE="origin"
DRY_RUN="${DRY_RUN:-0}"

cd "$(git rev-parse --show-toplevel)"
git fetch -p "$REMOTE"

CURRENT="$(git branch --show-current)"
mapfile -t ALL < <(git ls-remote --heads "$REMOTE" | awk '{print $2}' | sed 's|refs/heads/||')

OLD=()
for b in "${ALL[@]}"; do
  [ "$b" = "main" ] && continue
  [ "$b" = "$CURRENT" ] && continue
  d="$(git log -1 --format=%cs "$REMOTE/$b")"
  if [[ "$d" < "$CUTOFF" ]]; then
    OLD+=("$b")
    printf '  %-46s %s  unique-commits:%s\n' \
      "$b" "$d" "$(git rev-list --count "$REMOTE/main..$REMOTE/$b")"
  fi
done

echo
echo "${#OLD[@]} branch(es) older than $CUTOFF."
[ "${#OLD[@]}" -eq 0 ] && { echo "Nothing to do."; exit 0; }
if [ "$DRY_RUN" = "1" ]; then echo "DRY_RUN=1 — stopping."; exit 0; fi

echo; echo "Tagging..."
for b in "${OLD[@]}"; do git tag -f "archive/$b" "$REMOTE/$b" >/dev/null; done

echo "Pushing tags..."
printf '%s\n' "${OLD[@]}" | sed 's|^|refs/tags/archive/|' | xargs git push --force "$REMOTE"

echo "Verifying tags on $REMOTE..."
MISSING=0
for b in "${OLD[@]}"; do
  if ! git ls-remote --tags "$REMOTE" "refs/tags/archive/$b" | grep -q .; then
    echo "  MISSING: archive/$b"; MISSING=1
  fi
done
if [ "$MISSING" = "1" ]; then
  echo "ABORTING — some tags are not on the remote. No branches deleted."
  exit 1
fi
echo "All ${#OLD[@]} tags confirmed on $REMOTE."

echo; echo "Deleting branches..."
printf '%s\n' "${OLD[@]}" | xargs -n 20 git push --delete "$REMOTE"

echo; echo "Done. ${#OLD[@]} archived and deleted."
git ls-remote --heads "$REMOTE" | awk '{print "  "$2}' | sed 's|refs/heads/||'
```

---

## Housekeeping

- This file is **untracked** — it was written while shell tools were unavailable,
  so it could not be committed. Commit it (not to `main`) or delete it.
- `HANDOFF.md` at the repo root is also untracked and predates this work; it was
  not read or modified.
- `.claude/launch.json` is untracked local tooling. Its `vng-dev` entry (port
  5173) is what was used for verification here. It also has a
  `chiefeo-vng-preview` entry pointing at `../chiefeo-vng` — delete if unwanted.
- `chiefeo-vng` was **never opened or modified** at any point in this work.
