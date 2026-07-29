> **ARCHIVED — superseded.** This was the root `HANDOFF.md`. It documents PR #121
> only, and predates the VNG extraction. Its "State / follow-ups" list is fully
> resolved or obsolete: local `main` has been synced, `simplify-homepage-client-filter`
> has been deleted from the remote, the `.claude/` question is settled (left
> untracked), and PR #121's deploy shipped long ago. Kept for the PR #121
> rationale and the `landing_page_vng.md` provenance note at the bottom, which is
> still live context. For current state see `VNG-EXTRACTION-PHASE-B-HANDOFF.md`.

# Handoff — Homepage client-filter simplification

**Date:** 2026-07-29
**Repo:** `variance-narrative-generator` (serves chiefeotool.com)
**Branch:** `simplify-homepage-client-filter` → **merged to `main` via PR #121**
**Merge commit:** `01e58e6`
**Change commit:** `2648d4c`

---

## What shipped

The VNG homepage (`chiefeotool.com/`) lost two long-form sections and gained one
short ideal-client statement in their place. Net: **1 file changed, +2 / −44 lines.**

### Removed — `src/components/HomeLandingContent.jsx`

1. **"Who this is for"** — `<h3>` plus a 4-bullet `<ul>`:
   Assistant property managers · Junior PMs · Property accountants · Anyone
   covering for someone else this month.
2. **"What it solves"** — `<h3>` plus 3 paragraphs of variance
   problem/solution prose (repetitive-and-high-stakes framing → the manual
   pull/trace/write loop → "VNG collapses that process").

### Added — same file, same position

Placed exactly where those two sections sat: after the hero `<h2>` + "Try VNG
Now" CTA, immediately before **Features**.

```jsx
<section>
  <p>
    <strong>Built for property professionals</strong> who value speed and transparency. No
    setup, no contracts—just drop a file and get instant value.
  </p>
</section>
```

Uses `<strong>` to match the surrounding file's markup style. Note the em dash
in "contracts—just" is a literal `—`, consistent with the file's typographic
characters elsewhere.

### Page flow after the change

hero + CTA → **ideal-client statement** → Features → How it works → Real
use-case example → FAQ → closing CTA block → tool cross-links nav.

---

## Verification performed

| Check | Result |
| --- | --- |
| `npm run build` | Clean, built in 18.12s. Only the pre-existing >500 kB chunk-size advisory, unrelated to this change. |
| `npm test` | 952 tests, **952 pass, 0 fail**, ~20s. |
| JSX validity | Confirmed via successful build (no parse/tag errors). |
| Merged content on `origin/main` | Re-read after merge — replacement present at line 31; zero occurrences of the deleted headings. |

No browser preview was run: this is a static copy deletion already proven to
compile, and a dev server wouldn't have verified anything the build didn't.

---

## Dangling references — checked, none to fix

A repo-wide grep for `"Who this is for"` / `"What it solves"` (jsx, js, css,
html, md, json; excluding `node_modules`, `dist`, `.git`) returned hits only in:

- `public/tools/orgen.html`
- `public/tools/downdriller.html`
- `public/tools/chiefeoinspector.html`

**These were deliberately left alone.** They are the *other tools'* own static
SEO landing pages, each with independently-authored sections that happen to
share the same headings. They do not link to or reference the VNG homepage
sections that were removed — so nothing points at deleted content.

No test file referenced the removed copy. The FAQ on the homepage never
cross-referenced either deleted section.

### CSS — nothing removed, nothing dead

Every rule in `src/styles/app.css` (~lines 1105–1182) under `.home-landing` is
either a generic element selector (`h3`, `p`, `ul`, `ol`, `li`) still exercised
by the surviving Features / How it works / FAQ sections, or a class still in use
(`.home-landing-cta`, `-table`, `-faq`, `-cta-block`, `-links`). No styles were
orphaned by the deletion.

---

## State / follow-ups

- `main` was never committed to directly. It was only checked out to `git pull`
  before branching; all work landed on `simplify-homepage-client-filter` and
  reached `main` through PR #121.
- No GitHub token was used. The push authenticated through the local Git
  Credential Manager; `gh` CLI is not installed on this machine.
- **Local `main` is behind `origin/main`** as of this writing — run
  `git checkout main && git pull` to sync before starting the next task.
- The merged branch `simplify-homepage-client-filter` still exists locally and
  on the remote; safe to delete whenever convenient.
- `.claude/` is untracked in the working tree and was intentionally excluded
  from the commit. Decide whether to commit or `.gitignore` it.
- **Deployment:** confirm the Vercel production deploy picked up `01e58e6` and
  that the live homepage reflects the new copy.

### Content context worth knowing

`HomeLandingContent.jsx` carries a header comment explaining its provenance: the
copy originates from the SEO package's `landing_page_vng.md`, and
`DEPLOYMENT_CHECKLIST.md` maps that VNG landing copy onto the homepage because
VNG has no URL of its own.

**Neither of those files exists in this repo** — both are external to the clone,
so their current contents are unverified from here. If they still carry the
"Who this is for" / "What it solves" copy, regenerating the homepage from them
would reintroduce the deleted sections. Worth checking and pruning at the source
if this simplification is meant to stick. See also `docs/seo-integration-notes.md`,
which is in-repo.
