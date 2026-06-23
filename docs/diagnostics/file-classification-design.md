# Content-aware file classification — design proposal

**Status:** Proposal / investigation only. No production code in this change.
**Scope:** Recognize a standalone **budget** file by its content/structure (not
its filename) so it feeds the budget-context feature (Phase 2B), **without ever
misclassifying the base variance report or a GL**.

> ⚠️ This document is a design. Implementation is deferred pending approval.

---

## 0. The trigger

A real annual budget was exported as **`GL Worksheet (1).pdf`** (Kardin Budget
System; header text *"Kardin Budget System / File: 2026 Budget"*; twelve monthly
**Budget** columns, `$/RSF`, proforma lines, **no Actuals**).

- Today it is classified **General Ledger (GL)** purely because the filename
  contains "GL".
- So it is never seen as a budget, never feeds Phase 2B budget-context, and is
  instead sent down the GL evidence path (where it yields nothing useful).

---

## 1. Current state — how a file's type is decided today

### 1.1 Filename-only classification — `src/lib/classify.js`

`classifyFile({ name, role })` is the single classifier. It inspects **only**:

1. **Upload role** — `role === 'baseReport'` ⇒ `{ type: 'Base Variance Report',
   confidence: 100 }`. Role always wins.
2. **Filename keyword rules** (first match wins), against the lowercased stem:

   | Order | Type | Regex |
   |------|------|-------|
   | 1 | General Ledger (GL) | `general[\s_-]*ledger | (^|[^a-z])gl([^a-z]|$)` |
   | 2 | Budget | `budget | forecast` |
   | 3 | Prior Month Report | `prior | previous | last month | prev month` |
   | 4 | Existing Variance Report | `variance | var[\s_-]*report` |
   | 5 | Owner Example | `owner | sample | example | template | exhibit` |
3. **Fallback** — `{ type: 'Supporting Document', confidence: 55 }`.

It **never opens the file**. The module header says so explicitly. The Kardin
file matches rule 1 (`gl` token) → **GL, confidence 95**. Rule order also means a
file named "GL Budget" would resolve to GL (GL is checked before Budget).

### 1.2 How the BASE report is chosen — `src/lib/uploadRouting.js`

`routeUpload()` (called from `SourceFiles.jsx` on every drop) decides which file
occupies the **base slot**, using `classifyFile` **by name only**:

- `selectBase()` priority:
  1. A file the classifier names **`Existing Variance Report`** (highest
     filename confidence wins; ties keep drop order).
  2. Only when there is **no base yet**: a file that fell to the generic
     `Supporting Document`.
  3. Only when there is no base yet: the first file.
- **Rule 4 (the base guard):** once a base exists, an ambiguous batch never
  displaces it — *only* an explicit variance-named file (priority 1) can replace
  a base already in place.

The chosen file is stored as `baseReport` (App state). At extraction time
`useExtraction` calls `classifyFile({ name, role: 'baseReport' })`, so the base's
type is forced to **`Base Variance Report`** by role — regardless of its name or
content.

### 1.3 Where content IS already inspected

Two content detectors exist, both in `src/lib/extract/`, run during
normalization (`normalize.js → normalizeSpreadsheet`):

- **`detectSectionedGL` / `parseSectionedGL`** (`fileType.js`) — flags an
  account-sectioned GL by a "Balance Forward" section-header marker and flattens
  it; sets `normalized.fileType = 'sectioned_gl'` (`SECTIONED_GL`).
- **`detectBudgetSummary`** (`fileType.js`) — sets `normalized.fileType =
  'budget_summary'` (`BUDGET_SUMMARY`) **only** when the columns contain the full
  set: `account` + `current…actual` + `current…budget` + `current…variance` +
  `ytd…actual` + `ytd…budget` + `ytd…variance`.

For **PDFs**, `reconstructTable` (`pdfTable.js`) dispatches by content too:
- `looksLikeGL` / `looksLikeSectionedGLText` require **Debit AND Credit** column
  words (or "Balance Forward" / "** Account Totals"), and explicitly exclude
  anything `detectVarianceReport` matches.
- `detectVarianceReport` (`pdfShared.js`) requires **all** of `actual`, `budget`,
  `variance`, and `ytd|year-to-date` to be present in the page text.
- **Precedence:** GL reconstruction runs when **classification says GL** (`gl
  ByClass`) **or** content says GL (`glByContent`); otherwise it falls through to
  the variance reconstructor.

**Would today's content detectors recognize the Kardin budget? No.**

| Detector | Needs | Kardin budget has | Result |
|---|---|---|---|
| `detectBudgetSummary` | Actual **and** Variance cols (current+YTD) | budget-only monthly cols, no actuals | ❌ not detected |
| `detectSectionedGL` | "Balance Forward" marker | none | ❌ |
| `looksLikeGL` (PDF) | Debit **and** Credit | none | ❌ |
| `detectVarianceReport` (PDF) | actual+budget+variance+ytd | only "budget" | ❌ |

Because the **filename** says GL, `reconstructTable` takes the GL branch
(`glByClass = true`), finds no GL header, and falls through to the variance
reconstructor — producing a messy table tagged **GL** by classification.

### 1.4 Everywhere the type label drives behavior (blast radius)

| Consumer | File | Reads | Effect of the label |
|---|---|---|---|
| Evidence index | `enrich/match.js` | `normalized.fileType` (skip `BUDGET_SUMMARY`; force GL for `SECTIONED_GL`) + `classification.type` | decides GL-vs-skip-vs-generic evidence |
| Enrichment phrasing | `enrich/index.js` | `classificationType` (`isGL`, `evidenceRank`) | GL sentence vs non-GL clause |
| Budget context (2B) | `enrich/budgetContext.js` | `classification.type` `/budget|forecast/` **or** `fileType===BUDGET_SUMMARY` | **whether a budget file is mined at all** |
| Enrichment status/diagnostic | `enrichmentStatus.js`, `enrichmentDiagnostic.js` | GL-by-`classificationType` | UI "GL enrichment" counts |
| PDF reconstruction | `extract/pdfTable.js` | `classificationType` GL | forces GL reconstruction path |
| Backup notice | `backupNotice.js` | `classifyFile(name)` GL test | "add a GL" recommendation |
| Base selection | `uploadRouting.js` | `classifyFile(name)` variance test | which file is the base |
| UI chip | `components/SourceFiles.jsx` | `classifyFile(name)` | the type shown to the user |

**Key safety observation:** the base report's type comes from **upload role**, and
which file is the base comes from `routeUpload` (filename + slot). **Content
classification of supporting files never touches base selection** as long as we
do not feed content into `routeUpload`/role. That is the seam that keeps the base
safe (see §2.3).

---

## 2. Proposed design — content signals + disambiguation

### 2.1 The three structurally distinct types

| Type | Defining structure |
|---|---|
| **Base variance report** (comparative income statement) | account rows × (**Actual + Budget + Variance**) for a period and/or YTD. The single file variance is computed from. |
| **Standalone budget** | **budget figures only, no actuals**; usually many period/monthly columns (Jan…Dec), `$/RSF`, proforma; sometimes a "Budget System"/"Budget" report marker. (The Kardin file.) |
| **General ledger** | transaction rows: entry date, source/reference, debit/credit, running balance, vendor/memo, account-section headings. |

### 2.2 Concrete content signals (from parsed content, not name)

Computed from `normalized.columns` + a bounded scan of `normalized.rows` (and, for
PDFs, the page-text markers already gathered). All deterministic.

**A. GL signals** (already largely implemented; keep authoritative):
- Column words **Debit AND Credit** (`looksLikeGL`), or section markers
  "Balance Forward" / "** Account Totals" (`looksLikeSectionedGLText`), or the
  flattened `SECTIONED_GL` fileType.
- Per-row **entry dates** + reference/memo columns.
- ⇒ **GL** (highest structural specificity among the three).

**B. Base-variance-report signals:**
- Presence of an **Actual** column **AND** a **Variance** column (with a Budget),
  for a period/YTD — i.e. `detectVarianceReport` (PDF) or
  `detectComparisonSets` finding a set with `actual !== null` **and**
  (`budget` or `prior`) `!== null`.
- The decisive discriminator vs a budget: **Actuals are present.**

**C. Standalone-budget signals (new):**
- A **budget basis** is present: a `Budget`/`Forecast`/`Plan` column, **or** a
  run of **≥ 6 month columns** (Jan…Dec / 01…12) — reuse the month-run detector
  already written for Phase 2B (`budgetContext.derivePhasing` / `monthCols`).
- **No Actuals** and **no Variance** columns (this is what separates it from the
  base report).
- **No GL signals** (no Debit/Credit, no transaction dates per row).
- Optional **corroborating markers** (raise confidence, never required):
  `$/RSF`, `RSF`, `proforma`, `annual budget`, `budget system`, a "Budget" report
  title in the header text.
- ⇒ **Budget** (new `fileType = 'STANDALONE_BUDGET'`, or reuse `BUDGET_SUMMARY`
  generalized — see §4).

### 2.3 Disambiguation rule with precedence

Evaluate content in this **fixed order** (most structurally specific first); the
first match wins:

```
1. GL            ← Debit&Credit / Balance-Forward / sectioned-GL markers
2. BASE REPORT   ← has Actual AND Variance (with Budget), per period/YTD
3. STANDALONE    ← budget basis (Budget col OR ≥6 month cols) AND no Actuals
   BUDGET           AND no Variance AND no GL signals
4. (no match)    ← keep the existing filename label (advisory)
```

Rationale for the order:
- **GL first** — its Debit/Credit signature is unambiguous and never appears in a
  comparative statement or a budget.
- **Base report before budget** — a comparative statement *also* contains budget
  columns; gating budget on **"no Actuals"** guarantees a real base report can
  never be mistaken for a standalone budget (it always has Actuals + Variance).
- **Budget last among the positives** — it is defined partly by **absence**
  (no actuals/variance/GL), so it must only be reached after the two
  presence-based types are ruled out.

**Filename vs content — which wins:**
- For **type/classification used by enrichment**, **content wins** over filename
  when content produces a confident match (this is the whole point: Kardin is a
  budget regardless of its "GL" name).
- For **base-slot selection**, **filename + role stay authoritative and content
  is NOT consulted** (see the guard below). Content classification refines a
  *supporting* file's type only.

### 2.4 The base-report guard (the critical safety rule)

The base report must never be demoted by content classification. Two layers:

1. **Role precedence is preserved.** `classifyFile` keeps returning
   `Base Variance Report` for `role === 'baseReport'` **before** any content
   logic runs. Content classification is applied **only to non-base files**.
2. **`routeUpload`/`selectBase` are NOT changed to read content.** Base selection
   stays filename-driven, and **Rule 4** still holds: an existing base is only
   ever replaced by an explicit variance-named file. So even if a content
   detector decides a *supporting* file "looks like a base report", that never
   moves it into the base slot — it would at most surface as a hint in the UI.

> Net: content classification can change a **supporting** file's type label
> (GL → Budget for Kardin), which only affects the **enrichment** path. It cannot
> change which file `computeVariance` runs on. The variance input contract is
> untouched.

### 2.5 Confidence & fallback

- Each content detector returns a confident boolean (the signatures are
  conservative by construction). When content is **confident**, it overrides the
  filename type for supporting files and records `basis: 'content'`.
- When content is **ambiguous / no match**, **keep the existing filename label**
  (`basis: 'filename'`) — never guess, never demote. The current behavior is the
  safe default.
- The base is **never** silently demoted: role wins, and base selection ignores
  content.

---

## 3. How the proposal classifies the real files (read-only)

> The sample files were not available in this environment
> (`/mnt/user-data/uploads` is absent), so the following traces the documented
> structures through the actual code paths above. Re-run against the real PDFs
> before implementing to confirm the page-text markers.

| File | Today | Proposed | Deciding signals |
|---|---|---|---|
| **`GL Worksheet (1).pdf`** (Kardin 2026 Budget) | **GL** (filename `gl`) → GL reconstruction → tagged GL; **excluded from 2B** | **Standalone Budget** | GL rule fails (no Debit/Credit, no Balance-Forward); base-report rule fails (**no Actuals/Variance**); budget rule matches (≥6 month columns / Budget basis, no actuals, no GL) + corroborating "Budget System"/`$/RSF` markers |
| **Comparative income statement** (true base) | base via role/slot; type `Base Variance Report` | **unchanged — Base Variance Report** | role wins (never content-classified); content rule 2 also matches (Actual + Variance) but is irrelevant for the base slot |
| **True GL** | GL (filename and/or Debit/Credit content) | **unchanged — GL** | rule 1 matches (Debit/Credit / Balance-Forward) |

**Confirmation of the two failure modes we must avoid:**
- The base report still has **Actual + Variance**, so it can *never* fall to the
  budget branch (rule 3 requires *no* actuals). And it is selected by role/slot,
  not content. ✅ Base is safe.
- The true GL still trips the Debit/Credit signature (rule 1) before the budget
  rule is even considered. ✅ GL is safe.
- The Kardin budget now matches rule 3 and feeds 2B. ✅ Bug fixed.

---

## 4. Implementation scope (describe — do not build)

### 4.1 Files / functions that would change

- **`src/lib/extract/fileType.js`** — add `detectStandaloneBudget(columns, rows,
  pageText?)` and a `STANDALONE_BUDGET` tag; reuse the month-run detector from
  `enrich/budgetContext.js` (or lift it into a shared helper). Optionally
  generalize `BUDGET_SUMMARY` so 2B treats both summary and standalone budgets
  uniformly.
- **`src/lib/extract/normalize.js`** — in `normalizeSpreadsheet`, after the GL and
  budget-summary checks, set `normalized.fileType = STANDALONE_BUDGET` when
  detected. (Additive; columns/rows unchanged.)
- **PDF path** — for the Kardin PDF, add a `looksLikeBudget(lines)` text check
  (budget markers + month run, **and not** `detectVarianceReport` /
  `looksLikeGL`) and make `reconstructTable` **not** take the GL branch when the
  filename says GL but content says budget. Today `glByClass` (filename) forces
  GL; the fix is to let confident **content** veto the filename's GL branch.
- **`src/lib/classify.js`** — introduce a content-aware layer. Cleanest shape: a
  new `classifyWithContent({ name, role, normalized, pageText })` that calls the
  existing `classifyFile` for the role/filename baseline, then overrides the type
  for **non-base** files when a content detector is confident. Keep `classifyFile`
  (name-only) intact for `routeUpload` and `backupNotice`.
- **`src/lib/enrich/budgetContext.js`** — `isBudgetFile` recognizes the new
  `STANDALONE_BUDGET` tag (one-line addition); the rest of 2B already consumes a
  budget file's columns/rows generically.
- **UI** — `SourceFiles.jsx` chip would show the corrected type once the
  content-aware classifier is wired to the extraction result.

### 4.2 Blast radius

Everything in the §1.4 table reads the **type label**. The change makes the label
*more accurate*; the risk is concentrated where the label flips **GL → Budget**:
- Evidence index stops mining the Kardin file as GL (correct — it has no
  transactions); 2B starts mining it for budget context (the goal).
- Enrichment status/diagnostic GL counts drop for that file (correct — it is not
  a GL).
- PDF reconstruction stops forcing the GL path for it.

### 4.3 Can this avoid touching the variance input contract? **Yes.**

`computeVariance` runs on the **base** extraction only, selected by role/slot.
This proposal never changes base selection and never feeds content into
`routeUpload`/role. Reclassification affects **supporting** files and the
**enrichment** path exclusively. The "variance byte-identical with/without"
guardrail from Phase 2B remains the regression gate.

### 4.4 Test plan

- **Detector unit tests:** Kardin-shaped budget (month run, no actuals) →
  Budget; comparative statement (actual+variance) → **not** budget; true GL
  (debit/credit) → GL; ambiguous grid → no content match (keep filename).
- **Base-safety tests (highest priority):**
  - A file named `GL …` whose content is a budget classifies as Budget **but is
    never selected as base**; `routeUpload` output unchanged.
  - The real base report keeps `Base Variance Report` (role) even if its content
    matches rule 2; `computeVariance` output **byte-identical** to today.
- **End-to-end:** base report + Kardin "GL Worksheet" → variance unchanged, and
  the Kardin file now feeds 2B budget-context on matched accounts.
- **Regression:** existing GL enrichment tests still pass (true GL still GL).

### 4.5 Risks & mitigations

| Risk | Mitigation |
|---|---|
| A budget mistaken for the base report | Base is role/slot-selected; content never feeds base selection. Rule 3 requires **no actuals**, so a real base can't match the budget rule anyway. |
| A base report mistaken for a budget | Same — base report always has Actuals + Variance (rule 2 before rule 3). |
| A GL mistaken for a budget | GL rule 1 (Debit/Credit / Balance-Forward) evaluated first. |
| Month-run false positives (e.g. a report with month columns of actuals) | Budget rule also requires **no Actuals/Variance**; a monthly *actuals* report fails it and stays unclassified or base. |
| PDF text-marker variance across exporters | Keep detectors conservative (require the structural signature, treat markers as corroborating only); re-test against real PDFs before shipping. |
| Hidden consumers of the old label | §1.4 enumerates them; all are enrichment/UI-only — none touch variance math. |

---

## 5. Recommendation

Proceed in a follow-up implementation phase with the **content-first,
filename-fallback** classifier and the **base stays role/slot-selected** guard.
The change is additive and isolated to the extraction `fileType` tag + a
content-aware classification layer; it fixes the Kardin misclassification and
unlocks Phase 2B for it, while the base-report and GL paths are provably
unaffected (rule ordering + role precedence + unchanged variance input contract).

**Stop here for approval before writing code.**
