# Handoff — VNG extraction close-out

**Date:** 2026-07-29
**Repo:** `variance-narrative-generator` (the hub — serves chiefeotool.com)
**Branch:** `chore/close-out-vng-extraction` → **merged to `main` via PR #125**
**Merge commit:** `0624be8`
**Change commit:** `6fbf469`

This closes the VNG extraction workstream. Phases A and B did the extraction and
the hub cleanup; this pass verified the deploy that had shipped unverified,
resolved 45 stale remote branches, and closed the last sitemap gap. **Nothing
about the extraction itself remains open.**

Read this together with:

- `VNG-EXTRACTION-HANDOFF.md` — Phase A, the extraction plan
- `VNG-EXTRACTION-PHASE-B-HANDOFF.md` — Phase B, the hub cleanup (was untracked; committed in `6fbf469`)
- `docs/archive/handoff-homepage-client-filter.md` — the former root `HANDOFF.md`, archived (see below)

**VNG ≠ ORGEN.** Variance Narrative Generator is `/vng`, repo `chiefeo-vng`.
Owner Report Generator is `/orgen`, repo `owner-report-generator`. Different
tools. Do not conflate them.

---

## 1. Deploy verification — the Phase B deploy was sound

Phase B merged as `b4097ce` but was never checked live; a tooling outage hit
first. All 16 paths verified **200** against `https://www.chiefeotool.com`:

| Path | | Path | |
| --- | --- | --- | --- |
| `/` | 200 | `/tools/vng` | 200 |
| `/skills` | 200 | `/tools/orgen` | 200 |
| `/tos` | 200 | `/tools/downdriller` | 200 |
| `/privacy` | 200 | `/tools/chiefeoinspector` | 200 |
| `/vng` | 200 | `/sitemap.xml` | 200 |
| `/orgen` | 200 | `/robots.txt` | 200 |
| `/downdriller` | 200 | `/images/og-hub.png` | 200 |
| `/chiefeoinspector` | 200 | `/images/og-vng.png` | 200 |

The `/tools/vng` rewrite took correctly (a 404 there would have meant it didn't).
No abort condition was hit.

---

## 2. Remote branch cleanup — 45 branches resolved, 36 recoverable

The remote went from **46 branches to 1**. Because VNG history was never carried
to `chiefeo-vng` and `git filter-repo` is unavailable, **this repo is the sole
historical record of all pre-split VNG work** — hence the archive tags.

| Bucket | Count | Action |
| --- | --- | --- |
| Last commit before `2026-07-22` | **36** | Tagged `archive/<name>`, then deleted |
| Recent, 0 unique commits vs `main` | **8** | Deleted, no tag — tips already reachable from `main` |
| `chore/hub-cleanup-post-vng` | 1 | Deleted after confirming 0 unique commits (PR #124) |
| `chore/close-out-vng-extraction` | 1 | Deleted after PR #125 merged |
| Recent **with** unique commits | **0** | None found — nothing was left behind |

Counts matched the Phase B handoff's expected table exactly. The safety ordering
held: every tip was tagged, **all 36 tags were confirmed on the remote by SHA**,
and only then was anything deleted.

### Recovering an archived branch

```bash
git checkout -b <name> archive/<name>
```

Tags are **lightweight on purpose** so `git ls-remote --tags` returns the commit
SHA directly. Do not convert them to annotated tags — it breaks the SHA
verification step in the archive script.

### The 36 archive tags

<details>
<summary><code>git ls-remote --tags origin | grep archive/</code></summary>

```
claude/affectionate-cray-p9i14k          claude/upbeat-thompson-cncfph
claude/amazing-goodall-h9rkjx            claude/vng-feedback-widget-50x0kb
claude/bold-cannon-ttnzmj                claude/vng-minimal-default-layout-rd77qw
claude/budget-file-usage-diagnostic-f3ngb5   cleanup/step-1-dead-code
claude/eager-lamport-mirkza              cleanup/step-2-shared-regexes
claude/enrichment-status-fix-a           cleanup/step-3-shared-constants
claude/enrichment-status-partial         cleanup/step-4-detect-columns
claude/funny-curie-ehzyxw                cleanup/step-5-decompose
claude/happy-edison-e7uwc0               feature/style-controls
claude/hero-text-main-page-fh2d6g        ux/pwa-icon-and-meta
claude/keen-davinci-etou9b
claude/keen-edison-k5nc7p
claude/nq-2b-reviewed-notes
claude/nq-3a-commentary-planning-layer
claude/nq-3b-sections-consume-plan
claude/nq-3c-context-notes
claude/nq4b1b-consume-prepared-evidence
claude/nq4c1-account-resolution
claude/peaceful-cori-xkvecv
claude/pensive-carson-6e629t
claude/phase-20a-2-gl-commentary-polish
claude/practical-goodall-ld762n
claude/section-driven-variance-direction
claude/sharp-gauss-hurqho
claude/stoic-bardeen-k32g33
claude/trusting-carson-33hvpp
```

</details>

The 8 deleted without tags: `add-skills-page`,
`claude/utilities-forecaster-beta`, `feat/claude-api-disclosure`,
`feat/legal-pages`, `docs/vng-extraction-handoff`,
`feat/vng-extraction-hub-side`, `og-images-deploy`,
`simplify-homepage-client-filter`.

---

## 3. What changed in PR #125

3 files, +509 lines, one commit.

### Phase B handoff committed

`VNG-EXTRACTION-PHASE-B-HANDOFF.md` had been sitting untracked in the working
tree because shell tools were down when it was written — one temp-directory
cleanup from being lost. Now tracked at the root beside its Phase A sibling.

### Root `HANDOFF.md` → archived, not deleted

Moved to `docs/archive/handoff-homepage-client-filter.md` with a superseded
banner at the top.

It documented PR #121 (homepage client-filter simplification) only, predated the
extraction, and every item on its follow-up list is now resolved or obsolete.
**Superseded rather than deleted** for two reasons: it had never been committed,
so deleting it would have been unrecoverable; and its PR #121 rationale plus the
`landing_page_vng.md` / `DEPLOYMENT_CHECKLIST.md` provenance note at the bottom
are still live context worth keeping.

Moving it also freed the root `HANDOFF.md` name, which had been aiming every new
session at the wrong document — that was the more pressing problem.

### Sitemap gap closed

`/skills`, `/tos` and `/privacy` were all live and returning 200 but absent from
`public/sitemap.xml`. Added, preserving the file's existing descending-priority
structure:

| Entry | Priority | changefreq |
| --- | --- | --- |
| `/` | 1.0 | monthly |
| `/vng`, `/orgen`, `/downdriller`, `/chiefeoinspector` | 0.9 | weekly |
| **`/skills`** | **0.8** | **monthly** |
| `/tools/*` (4 pages) | 0.7 | monthly |
| **`/tos`**, **`/privacy`** | **0.3** | **yearly** |

12 `<url>` entries total, balanced and well-formed.

### `.claude/launch.json`

Left untracked and unmodified, `chiefeo-vng-preview` entry intact. A local
preview of the companion repo is useful now that the two are split.

---

## 4. JSON-LD `image` fields — the bug does not exist

Earlier notes suggested `SoftwareApplication` schema `image` fields might point
at nonexistent `/images/*-screenshot.png` paths. **They don't. Nothing was
changed.**

There is **no `"image"` key in any JSON-LD block in this repo.** All that exists
are comments in `public/tools/{orgen,downdriller,chiefeoinspector}.html` recording
that `"image"` was *deliberately omitted* because the asset was missing —
matching open item 3 in `docs/seo-integration-notes.md`. The note described a
decision, not a defect.

### One thing worth knowing for next time

The screenshot paths *appear* to return **200** live, but that is a false
positive — the SPA fallback serves `index.html`:

```
$ curl -sI https://www.chiefeotool.com/images/vng-screenshot.png
Content-Type: text/html; charset=utf-8
Content-Length: 4103
```

**A bare status-code check cannot detect a missing image on this host.** Check
`Content-Type` too. Had those paths been referenced, they would have broken every
link preview without ever 404-ing.

The five real cards in `public/images/` — `og-hub`, `og-vng`, `og-orgen`,
`og-downdriller`, `og-inspector` — are all correctly referenced and serve as
`image/png`. Note the inspector file is `og-inspector.png`, **not**
`og-chiefeoinspector.png`.

---

## 5. Post-merge verification — confirmed live

Production deploy for `0624be8` is Ready. Live `sitemap.xml` serves all **12**
entries including the three new ones, on the plain URL Search Console fetches:

```
$ curl -sI https://www.chiefeotool.com/sitemap.xml
Etag: "d3262b93e62f13f4c1ce188ee498ac2a"
Last-Modified: Wed, 29 Jul 2026 23:18:34 GMT
X-Vercel-Cache: HIT
```

Apex `https://chiefeotool.com/sitemap.xml` follows its 308 to `www` and returns
200. `/skills`, `/tos`, `/privacy` all still 200. No `image` URLs were repointed,
so there were none to re-verify.

**One gotcha:** the first post-merge check returned the *old* 9-entry sitemap with
`Age: 9968` and a stale ETag, and a `?cb=` query param did **not** bust it — that
request raced the deploy rather than hitting a cache wall. Compare `ETag` and
`Last-Modified` against `/` (which has `Age: 0`) to tell "stale cache" from
"deploy still building." Do not conclude a deploy failed from one stale read.

---

## 6. Current state

| | |
| --- | --- |
| Remote branches | **`main` only** |
| Archive tags | 36, all SHA-verified on `origin` |
| `main` tip | `0624be8` |
| Local `main` | synced, fast-forwarded, **never committed to directly** |
| Working tree | clean except untracked `.claude/` (intentional) |
| Live site | all 16 verified paths 200; sitemap complete at 12 entries |

---

## 7. Open items carried forward

None of these block anything. Nothing here belongs to the extraction.

### In this repo

1. **`docs/seo-integration-notes.md` is partly stale.** Open item 5 says the
   `/tools/*` pages aren't in the sitemap — they have been since `b4097ce`.
   Open item 3's premise is the non-bug in section 4 above. Item 2 (`"price": "0"`
   asserted in all four schema blocks, unconfirmed — a Rich Results violation
   risk if inaccurate) and item 4 (a dropped FAQ item that contradicts the
   "Beta" button label) are **still genuinely open**. Worth a pass to prune the
   resolved items so the live ones stand out.
2. **Real screenshots.** If they ever land: add the `image` fields back and
   switch `twitter:card` to `summary_large_image` (it's `summary` now because
   only a square icon and the OG cards exist).
3. **Submit the updated sitemap in Google Search Console.** Three new URLs.

### Deliberately out of scope — do not touch without a decision

- **`chiefeo-vng`.** Was not opened during this work.
- **`GL-Down-Driller`, `chiefeo-inspector`, `owner-report-generator`** and their
  deployments. Their README version / QA-count staleness is a separate
  workstream.
- **Renaming this repo or the Vercel project.** The repo is still called
  `variance-narrative-generator` even though VNG now lives in `chiefeo-vng` and
  this is the hub. Deliberately excluded — renaming touches the Vercel git
  connection and every existing URL.
- **The `/tools/*` canonical-URL posture.** Unresolved; left as-is.
- **The duplicate `<title>` overlap between `/orgen` and `/tools/orgen`.** Known,
  not urgent, no decision made.

---

## 8. Environment constraints for the next session

These are machine facts, not preferences. They cost time to rediscover.

- **No GitHub token; `gh` CLI is not installed.** Push authenticates through
  Windows Credential Manager. PRs must be opened and merged by hand from the
  compare URL — hand the URL back rather than trying to automate the merge.
- **Never commit to `main`.** This environment has silently reverted the checked-out
  branch mid-session. Guard every commit:
  ```bash
  test "$(git branch --show-current)" = "<branch>" || { echo "WRONG BRANCH"; exit 1; }
  ```
- **`vercel --prod` is blocked by the permission classifier.** Deploy via git
  push (projects are git-connected) or `vercel redeploy <url>`. Read-only
  `vercel ls` **does** work and is the fastest way to confirm a production
  deploy is Ready.
- **Apex `chiefeotool.com` 308-redirects to `www`.** Verify against `www`.
- **`git filter-repo` is unavailable.** Relevant to any future history surgery.
- **Grep `public/stacking.html` with care.** It carries a minified PptxGenJS
  bundle; a loose pattern against it returns megabytes. Scope greps to specific
  files when searching HTML for schema keys.
