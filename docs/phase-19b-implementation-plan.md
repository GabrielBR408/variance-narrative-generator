# Phase 19B — Evidence Contribution Ranking
**Implementation Plan (plan only — no code, no merge, no PR)**

Repo: `variance-narrative-generator` · Base: `main @ 5d6309a` (Phase 19A merged)
Branch: `claude/gifted-ride-n0uipf` · Authority: ChatGPT owns PM/architecture/QA · Claude owns implementation
Status: **Approved phase. Plan only. No implementation. No merge. No PR.**

> Approved architecture decision (this plan honors it): **`match.js` stays
> matching-only — it is NOT made contribution-aware.** Contribution ranking lives
> in a new pure module `src/lib/enrich/contribution.js`. The vendor/description
> column-typing needed to *feed* it is a **summarize** concern, placed in the
> summarize stage, not in matching and not in contribution.

Pipeline (unchanged shape, one new stage):
```
extract → match → summarize → contribution → classify → template
```

---

## 1. Implementation Architecture

### Data flow
```
buildEvidenceIndex / matchAccount            (match.js — UNCHANGED logic)
        │  citations: [{ fileName, classificationType, confidence,
        │               sourceRows, thick, rows[] }]
        ▼
summarizeDetail  (summarize stage)           (extended, additive)
        │  detail = { count, total, maxTxn, confidence,
        │             vendor, description }   ← vendor/description now COLUMN-TYPED
        ▼
rankContribution({ varianceAmount, comparisonType, accountType,
                   category, detail })        (contribution.js — NEW, pure)
        │  → { contributionType, ratio, directionAligned, amountReliable,
        │      vendorRenderable, descriptionRenderable }
        ▼
classifyGLCommentary(detail, contribution, …) (classify.js — MODIFIED)
        │  → { type }  (contribution gates/overrides the 19A shape)
        ▼
commentarySentence({ type, contribution, detail, account, period })
        │                                     (templates.js — MODIFIED)
        ▼
appendSentence → note.text                    (index.js — UNCHANGED join)
```

### Module responsibilities
- **match.js** — string matching only. Keeps every matched row (already deduped
  by `sourceRow`). **No contribution logic, no ranking.** The only thing it must
  preserve is the per-row, **column-typed** vendor/description/reference text so
  summarize can pick the right field (today `firstDetailText` collapses them and
  prefers Reference — that collapsing moves to summarize, see §2).
- **summarize** (`summarizeDetail`) — aggregates matched rows into `detail`,
  now including **`vendor`** (from the Vendor/Payee/Name column only),
  **`description`** (from the Description/Memo column only), and **`confidence`**
  (the citation's match score). Still null-gates `total` on ambiguity. No
  ranking, no cleanliness decisions beyond column selection.
- **contribution.js** (NEW, pure) — `rankContribution(input) → output` per the
  approved interface. Holds all ratio bands, the offset/direction guards, and the
  vendor/description **renderability** gates. No I/O, no string building.
- **classify.js** — maps `(detail, contribution)` to one category, with
  contribution taking precedence over the 19A shape.
- **templates.js** — renders the owner sentence, optionally embedding a clean
  vendor *or* description (never both), all amounts via `approxMoney()`.

### Approved interface (implemented verbatim)
```js
// contribution.js
export function rankContribution({
  varianceAmount, comparisonType, accountType, category,
  detail: { total, maxTxn, count, vendor, description, confidence }
}) {
  return { contributionType, ratio, directionAligned,
           amountReliable, vendorRenderable, descriptionRenderable }
}
```

---

## 2. Required Code Changes (exact files)

| File | Change | Why |
|---|---|---|
| `src/lib/enrich/match.js` | **MODIFY (minimal, non-contribution)** | Replace the single collapsed `firstDetailText` with **column-typed** capture: carry `vendorText` (Vendor/Payee/Name cols) and `descText` (Description/Memo/Detail cols) separately per entry; keep Reference/invoice/check/doc **out** of both. `summarizeDetail` then exposes `detail.vendor`, `detail.description`, and `detail.confidence`. **No ratio/contribution code added here.** Existing `count`/`total`/`maxTxn` semantics and the `total=null` ambiguity gate are untouched. |
| `src/lib/enrich/contribution.js` | **NEW** | The approved pure ranker: ratio, bands, offset guard, direction guard, vendor/description renderability gates, all constants. |
| `src/lib/enrich/classify.js` | **MODIFY** | Accept the contribution result; apply precedence (contribution gates override 19A shape). Keep existing shape constants. |
| `src/lib/enrich/templates.js` | **MODIFY** | Contribution-aware builders; optional clean vendor **or** description embedding; `approxMoney`/`descriptorFor` reused; Phase 17.1 no-causation preserved. |
| `src/lib/enrich/index.js` | **MODIFY** | In `enrichNote`, call `rankContribution` (passing `note.varianceAmount`, `comparisonType`, `accountType`, `category`, and `detail`) before `classifyGLCommentary`; thread `contribution` into the template. Identity / non-GL paths untouched. Re-export new symbols. |
| `test/contribution.test.js` | **NEW** | Unit coverage of every band, guard, and gate. |
| `test/enrich.test.js` | **MODIFY** | Update/extend GL expectation strings; add an integration case per contribution type; identity & forbidden-phrase tests stay. |
| `test/realReportQA.test.js` | **MODIFY** | Add real-MRI smoke + the §7 acceptance assertions. |

No changes outside `src/lib/enrich/` and `test/`. No new dependencies. No variance/extraction/threshold/export changes.

> Note on "summarize as its own stage": `summarizeDetail` physically lives in
> `match.js` today. Per the approved pipeline it is the **summarize** stage and
> may optionally be extracted to `src/lib/enrich/summarize.js` for clarity. Either
> is acceptable; the constraint honored is that **no contribution logic enters
> match.js**. Extraction is a refactor-only option, not required for correctness.

---

## 3. Contribution Decision Model

`ratio = isReliable(total) && |varianceAmount|>0 ? |total| / |varianceAmount| : null`
`isReliable(total) = typeof total === 'number' && isFinite(total) && total !== 0`

**Bands (firm thresholds from the approved spec; gaps resolved to the nearer soft band so exactly one type wins):**

| `contributionType` | Rule | Effect on category selection (`classify.js`) | Template consequence |
|---|---|---|---|
| **no-reliable-amount** | `!isReliable(total)` (ratio null) | Disables every amount-bearing shape (B/C/E/I and Direct). Routes to count/vendor/description wording or "available for review". | No dollar figure. May render count, or a clean vendor/description if gated. |
| **direction-conflict** | `directionAligned === false` (GL net sign opposes expected sign for `accountType`+`category`) | Highest override after reliability. Forces a credit/true-up frame; blocks Direct/Major/Recurring spend wording. | Soften or suppress the amount; explicitly note it runs counter to the variance direction; review flag. |
| **offset-heavy** | `|maxTxn| > |total|` | Blocks "one of about $X" (Category B / Major single) wording. | Never render a single txn larger than the net total; optional "includes offsetting entries"; fall back to net-total or count wording. |
| **disproportionate** | `ratio > 2.00` (firm at `> 3.00`; `2.00–3.00` = soft/qualified). **`ratio > 10.00` ⇒ `suppressAmount = true`.** | Blocks confident shape; routes to a "substantially larger related activity" frame. | If `ratio > 10`: **no dollar figure at all.** Else: hedged, amount labeled as broader/gross activity, not variance-sized. |
| **partial** | `ratio < 0.50` (firm at `< 0.25`; `0.25–0.50` = soft) | Allows a quantified line but with a "portion of the movement" qualifier; blocks "the variance" framing. | Render total + explicit "a portion of the total movement". |
| **aligned** | `0.50 ≤ ratio ≤ 2.00`, not offset, not conflict | Enables the full 19A shape menu (A/B/C/E/I → Direct / Major single / Recurring / etc.). | Confident, quantified shape sentence. |
| **unquantified** | thick evidence but no reliable total **and** no usable count signal, or below the confidence floor for any claim | Terminal low-confidence. | "Detailed account activity was available for review." |

**Precedence (first match wins):**
`no-reliable-amount → direction-conflict → offset-heavy → disproportionate → partial → aligned → unquantified`.

**`directionAligned`** (GL is debit-positive: amount = debit − credit):
| accountType | category | expected net sign | aligned when |
|---|---|---|---|
| expense | unfavorable (over budget) | `> 0` | `total > 0` |
| expense | favorable (under budget) | `< 0` | `total < 0` |
| revenue | favorable (revenue up) | `< 0` (income posts as credit) | `total < 0` |
| revenue | unfavorable (revenue down) | `> 0` | `total > 0` |
| unknown / neutral | — | — | `directionAligned = true` (never assert a conflict we can't ground) |

**Outputs summary:**
- `contributionType` — one of the seven above.
- `ratio` — number or `null`.
- `directionAligned` — boolean.
- `amountReliable` — `isReliable(total)`.
- `vendorRenderable` / `descriptionRenderable` — booleans from §4.

---

## 4. Vendor / Description Rendering Plan

Both are computed in `contribution.js` from the already column-typed
`detail.vendor` / `detail.description`. Mutually exclusive (rule 7).

**`vendorRenderable === true` only when ALL hold:**
- `detail.confidence >= 0.90` (match is code- or name-exact, not substring),
- `detail.vendor` length `<= 30`,
- not numeric (`!/^\s*[\d.,$()%\-]+\s*$/`),
- not reference-like (rejected patterns below),
- `detail.count <= 3` (a small, attributable set — not a broad population),
- contains a letter (`/[A-Za-z]/`).

**`descriptionRenderable === true` only when ALL hold:**
- `detail.description` length `<= 50`,
- no invoice/check/reference pattern (below),
- a clean readable phrase: `/[A-Za-z]/`, not numeric-dominated, no money/date tokens.

**Rejection patterns (reject vendor OR description if matched):**
```
reference-like : /\b(inv|invoice|chk|check|ck|ref|po|ap|ar|doc|gs|je)\b|#\s*\d|\b\d{4,}\b/i
money token    : /\$|\(\s*\d|\d[\d,]*\.\d{2}\b/
date token     : /\b\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/
id-ish         : /^[A-Z]{1,4}\s*\d+$|^\d+[A-Z]+$/   (e.g. "AP 064697", "GS 00084362")
all-caps-code  : /^[A-Z0-9 \-]{2,}$/ with a digit   (codey, not a name)
```
**Mutual exclusion (rule 7):** if both pass, prefer **vendor** (more specific,
tighter `<=30`/`count<=3` gate); set `descriptionRenderable = false`.

**Never rendered, ever:** raw filenames, dates, references, invoice/check IDs,
unsupported causal claims (Phase 17.1 forbidden list preserved). A rendered
vendor/description is **context only** ("…related to <Vendor> activity…"), never
"<Vendor> caused/drove the variance".

---

## 5. Template Changes (before → after)

19A "before" is the current `commentarySentence` output. "After" is contribution-gated.

| Scenario | Before (19A) | After (19B) |
|---|---|---|
| **Aligned one-time** (repairs, one $18k, var $17k, R≈1.06) | "… a single transaction of approximately $18,000 …" | *(unchanged — already correct)* "… GL detail shows a single transaction of approximately $18,000 during the current period." |
| **Aligned recurring** (4×$1,000, total $4k, var $4.2k, R≈0.95) | "… approximately $4,000 across 4 recurring transactions …" | *(unchanged)* "… GL detail shows approximately $4,000 across 4 recurring transactions during the current period." |
| **Disproportionate** (var $2,189, GL net −$265,000, R≈121) | "… net credits of approximately $265,000 …" | "… GL detail reflects substantially larger related activity during the current period; only a portion is reflected in this variance." **(no dollar figure — R>10 suppress)** |
| **Partial** (var $40,000, total $1,800, R=0.045) | "… approximately $1,800 of related activity …" | "… GL detail shows approximately $1,800 of related activity during the current period, a portion of the total movement." |
| **Direction conflict** (unfavorable expense +$8,000, GL net −$5,000) | "… a single credit of approximately $5,000 …" | "… GL detail shows a net credit of approximately $5,000 during the current period, which runs counter to the variance direction and warrants review." |
| **Offset-heavy** (var $7,186, total $10,700, max $23,200) | "… $10,700 across N transactions, with one of about $23,200 …" | "… GL detail shows approximately $10,700 of related activity during the current period, including offsetting entries." **(no $23,200 line)** |
| **Vendor-renderable** (aligned, conf 1.0, count 2, vendor "PG&E") | "… approximately $300 across two related transactions …" | "… GL detail shows approximately $300 of related PG&E activity during the current period." |
| **Description-renderable** (aligned, count 1, desc "HVAC repair", no clean vendor) | "… a single transaction of approximately $500 …" | "… GL detail shows a single transaction of approximately $500 (HVAC repair) during the current period." |

All "after" amounts remain `approxMoney()`-rounded; the base variance sentence is
preserved verbatim and the GL sentence is appended as standalone context.

---

## 6. Test Plan

**Contribution unit tests (`test/contribution.test.js`)**
- Ratio bands: `R = 0.1, 0.24, 0.25, 0.49, 0.50, 1.0, 2.0, 2.5, 3.0, 3.1, 10.0, 11, 121` → expected `contributionType` and `ratio`.
- `R > 10` ⇒ amount-suppression flag set.
- Offset guard: `|maxTxn| > |total|` ⇒ `offset-heavy`, regardless of ratio.
- Direction guard matrix: expense×{fav,unfav}×{+,−}, revenue×{fav,unfav}×{+,−}, unknown ⇒ `directionAligned` correct; conflict ⇒ `direction-conflict`.
- `no-reliable-amount`: `total=null` ⇒ ratio null, `amountReliable=false`.
- Vendor gates: conf 0.89 reject; len 31 reject; numeric reject; "AP 064697"/"GS 00084362" reject; count 4 reject; "PG&E" (conf 1.0, count 2) accept.
- Description gates: 51 chars reject; "INV #123" reject; "HVAC repair" accept.
- Mutual exclusion: both eligible ⇒ vendor only.
- Purity: identical input twice ⇒ identical output object.

**Integration tests (`test/enrich.test.js`)**
- One end-to-end case per `contributionType` rendering the exact §5 "after" string, appended to the preserved base sentence.
- Identity: base-only / no-match output **byte-identical**.
- Markdown/DOCX bullet parity across all categories.
- Period-aware (`ytd` ⇒ "year-to-date") on representative cases.

**Real MRI smoke test (`test/realReportQA.test.js` + reuse `pdfGL.test.mjs` fixtures)**
- Drive the real stacked-header MRI GL rows (`54110 Real Estate Taxes`, `51101 Fire Sprinkler`, `14811 WIP Capital Improvements` ambiguous-amount, `ONE WORKPLACE`/`AP 064697`) through the full pipeline; assert defensible `contributionType` and that no `AP 064697`/`GS 00084362`/date renders while `ONE WORKPLACE`/`PG&E`-style vendors may.

**Leakage tests**
- Extend `FORBIDDEN` sweep: no filename, date token, reference/invoice/check ID, or causal phrase in any rendered line.
- No rendered single amount exceeds the rendered total (offset guard).
- No rendered dollar figure when `ratio > 10` (suppression).
- Every figure `approxMoney()`-rounded; no re-quoted raw row amount.

**Regression tests**
- Existing 19A category tests updated where contribution changes the output; all unchanged-behavior cases (aligned shapes) still pass.
- `match.js` `count`/`total`/`maxTxn`/identity tests unchanged and green.
- Full `node --test` suite + build green.

---

## 7. Acceptance Criteria (measurable pass/fail)

| ID | Criterion | Pass condition |
|---|---|---|
| **AC-1** | Misleading dollar comments reduced | On the QA corpus + §1 cases, every `disproportionate`/`direction-conflict`/`offset-heavy` note no longer renders a variance-sized dollar claim; the specific failures ($265,000-for-$2,189; $23,200 single line) are gone. |
| **AC-2** | `ratio > 10` suppresses dollars | No dollar figure renders for any note with `ratio > 10.0` (asserted unit + integration). |
| **AC-3** | No variance math changes | `varianceAmount`/`variancePercent`/base sentence byte-identical; base-only & no-match narratives identical object reference. |
| **AC-4** | No leakage | Zero filename/date/reference/invoice/check IDs and zero causal phrases in any rendered commentary (FORBIDDEN + ID/date sweeps green). |
| **AC-5** | Offset guard | No rendered single transaction amount exceeds the rendered net total. |
| **AC-6** | Vendor/description safety | No vendor rendered below conf 0.90 / len>30 / numeric / reference-like / count>3; never both vendor and description. |
| **AC-7** | Determinism | Same inputs ⇒ same `contributionType` and same rendered string. |
| **AC-8** | Tests/build green | Full `node --test` suite and build pass; Markdown/DOCX parity preserved. |

---

## 8. Risk Review

- **False vendor identification.** A reference/entity token mis-typed as a vendor
  could render a meaningless name. *Mitigation:* multi-gate (column-typed source +
  conf ≥ 0.90 + length + numeric + reference-pattern + count ≤ 3), reject-on-any-doubt,
  and the rejection-pattern battery in §4 (covers `AP 064697`/`GS …`). Default is
  **render nothing** when uncertain.
- **Over-suppression.** Aggressive guards could blank legitimate, helpful figures
  (e.g. an aligned note wrongly flagged offset/conflict). *Mitigation:* guards fire
  only on concrete signals (`ratio`, `|maxTxn|>|total|`, grounded sign); `unknown`
  accountType never asserts a conflict; QA tracks an "amount-rendered share" on
  aligned notes to detect regressions toward silence.
- **Owner readability.** Hedged "portion of the movement" / "runs counter to"
  phrasing must stay plain, single-clause, non-accusatory. *Mitigation:* §5 fixed
  templates, readability spot-check in QA, no compound triple-figure sentences.
- **Regression risk.** Aligned/shape output must not drift. *Mitigation:* contribution
  is a *gate layered on top* of 19A; aligned band reuses existing 19A categories
  verbatim; identity and parity tests are hard gates; `match.js` matching logic and
  its existing tests are untouched (only additive column-typed detail).

---

## 9. Recommendation

**Approve implementation.**

- Scope is bounded (`src/lib/enrich/` + tests), deterministic, and fully supported
  by data already computed; the only structural addition is the dictated pure
  `contribution.js` plus an additive, non-contribution column-typing tweak in the
  summarize stage.
- The approved architecture (contribution out of `match.js`; `extract → match →
  summarize → contribution → classify → template`) is respected exactly.
- The owner-facing wins (kills the $265k-for-$2k and $23,200-single-line classes)
  are high-value and low-risk; guards default to suppression, so the failure mode
  of the change is "less said", never "wrong said".

**Suggested build order:** (1) summarize column-typed `vendor`/`description`/
`confidence` + `match.js` detail split → (2) `contribution.js` + unit tests →
(3) `classify.js` precedence gates → (4) `templates.js` contribution-aware +
vendor/description embedding → (5) integration + MRI smoke + leakage + regression.

**Stop. Plan only — no Phase 19B code, no merge, no PR.**
