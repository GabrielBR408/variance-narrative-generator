# Phase 19B — Evidence Contribution Ranking + GL Detail Commentary
**Investigation & Implementation Specification (spec only — not implemented)**

Repo: `variance-narrative-generator` · Base: `main @ 5d6309a` (Phase 19A merged)
Authority: ChatGPT owns PM / architecture / QA · Claude owns implementation
Status: **Pre-build spec. No production code. No branch. No merge.**

> Problem in one line: Phase 19A made the GL sentence *shaped* (one-time /
> recurring / credit …), but the classifier **never compares the GL evidence to
> the variance it is supposed to illuminate**. `classifyGLCommentary()` reads
> `count, total, maxTxn, sign, confidence, thick, comparison` — it does **not**
> read `varianceAmount`, `accountType`, or `category`. So a $265,000 GL credit
> and a $2,189 variance produce a confident, technically-true, owner-confusing
> sentence. Phase 19B adds the missing **contribution-relevance** layer.

---

## 0. Grounding (what exists today, verified by reading the code)

- Enrichment is pure/deterministic, runs after the base narrative, lives in
  `src/lib/enrich/` (no AI, no network). Invariant: no match ⇒ same object
  reference ⇒ byte-identical base output.
- `match.js → summarizeDetail()` emits, per matched GL file:
  `{ count, total, maxTxn, topVendor, topVendorCount }`.
  - `total` is **`null` when amounts are ambiguous** (Debit+Credit, multi-amount) — a present total is trustworthy.
  - `maxTxn` is the **absolute** largest single matched amount (sign discarded).
  - `topVendor` is `firstDetailText(row, detailCols)` — the **first** detail
    column on the row. `DETAIL_COL_RE` matches
    `description|memo|detail|narrative|note|particular|reference|ref|vendor|payee|invoice|doc|check`,
    and `detailCols` is ordered by **column index**. In the reconstructed GL
    (`GL_COLUMNS = [Account, Date, Reference, Vendor, Description, Amount]`)
    **Reference (idx 2) precedes Vendor (idx 3)** → `topVendor` is frequently an
    invoice / check / reference **ID**, not a vendor name. This is exactly why
    19A forbade rendering it.
- Each note (`sections.js → toNote()`) carries: `account`, `category`
  (`favorable|unfavorable|neutral`), `accountType` (`revenue|expense|unknown`),
  `comparisonType`, `varianceAmount`, `variancePercent`, `actual`, `comparison`.
- `classify.js → classifyGLCommentary()` consumes **only**
  `{ detail, comparison, comparisonType, confidence, thick }`. **`varianceAmount`,
  `accountType`, and `category` are available on the note but unused.** ← root cause.
- `templates.js` renders via `approxMoney()` (rounded "approximately") and the
  Phase 17.1 no-causation rule. `descriptorFor(account)` is the only label source.

**The fix slots a contribution-ranking step between `detail` and the category
templates, fed by `varianceAmount`/direction, and (sub-task) splits the GL
vendor column out of the reference/ID columns so a clean vendor can be rendered.**

---

## 1. Current Failure Modes (≥10, from current `main` behavior)

Each is reproducible against the Phase 19A decision tree in `classify.js`.
`R = |GL total| / |varianceAmount|` (contribution ratio); `ratio = maxTxn/|total|`.

| # | Failure | Concrete case | What 19A renders today | Why it's wrong |
|---|---|---|---|---|
| 1 | **GL total ≫ variance** | var $2,189, GL net **−$265,000** | E: "GL detail shows net credits of approximately $265,000…" | R ≈ 121×. A quarter-million credit cannot "be the context" for a $2k swing; reads as if it explains it. |
| 2 | **max txn exceeds total** | var $7,186, GL total **$10,700**, max txn **$23,200** | B: "…approximately $10,700 across N transactions, with one of about $23,200…" | `ratio = 2.17 ≥ 0.80` ⇒ B fires. A single line larger than the whole net total implies large offsets the sentence never admits; three irreconcilable dollar figures. |
| 3 | **Direction conflict (expense)** | unfavorable (over budget) expense var **+$8,000**, GL net **−$5,000** | E: "single credit of approximately $5,000…" | A *credit* is offered as context for an *overage*. Sign of net activity contradicts the variance direction; 19A keys E purely on `total < 0`. |
| 4 | **Revenue sign inversion** | revenue, favorable var (revenue **up** $12k), GL revenue postings net negative under debit-positive convention | E "credit" or A wording with wrong polarity | Revenue accounts invert: a credit is normal income, not a true-up. 19A has no `accountType` branch. |
| 5 | **Related but tiny** | var **$40,000**, GL total **$1,800** | A/F: "…approximately $1,800 of related activity…" | R = 0.045. Owner reads $1,800 as the account's story for a $40k move; under-explains. |
| 6 | **Unbudgeted swamps ratio** | comparison 0, var $3,000, GL total **$90,000** | D: "Activity occurred without a budget allocation; GL detail shows approximately $90,000…" | D fires on `comparison==0` regardless of R (30×). The $90k tail dwarfs the structural point. |
| 7 | **Recurring hides magnitude** | 4 even $1,000 charges (total $4,000), var **$30,000** | C: "…approximately $4,000 across 4 recurring transactions…" | "Routine/recurring" framing buries that GL covers ~13% of the swing (R = 0.13). |
| 8 | **True-but-confusing precision** | var $7,186, total $10,700, max $9,000 | B with three dollar amounts | Owner sees variance ≠ total ≠ maxTxn and cannot reconcile; technically correct, operationally useless. |
| 9 | **Offsets read as concentration** | 2 txns **+$60,000 / −$54,000**, net $6,000, max $60,000, var $5,500 | B (`ratio=10`): "…$6,000 across 2 transactions, with one of about $60,000…" | A near-washing pair is described as a dominant transaction. |
| 10 | **Net-near-zero, huge gross** | gross ~$250,000 in/out, net total **$300**, var $5,000 | A/F: "…approximately $300 of related activity…" | Net of $300 is rendered as the contribution; massively understates and mis-relates. |
| 11 | **Ambiguous total → no signal** | Debit+Credit columns ⇒ `total=null`, clean $20k single charge present, var $19k | F/G: "Detailed activity includes 1 related transaction…" | A perfectly aligned single charge (R≈1.0) gives the owner **no** contribution signal because the total was suppressed. |
| 12 | **Reference ID leaks as "vendor"** | GL Vendor="ONE WORKPLACE", Reference="AP 064697" | (suppressed entirely in 19A) | `firstDetailText` returns Reference before Vendor ⇒ "topVendor" is `AP 064697`; 19A had to suppress *all* vendor text, losing the real, renderable vendor name. |

Common thread: **failures 1–10 all stem from the absence of `R` (GL-vs-variance
ranking); 11–12 stem from `summarizeDetail` collapsing/suppressing detail that
is actually renderable.**

---

## 2. Available GL Detail — inventory & reliability

| Field | Source | Reliable to *render*? | Notes |
|---|---|---|---|
| `count` | `summarizeDetail`, deduped by sourceRow | **Yes** | Cannot be inflated by repeated rows. |
| `total` (net) | sum of reliable row amounts, else `null` | **Yes when non-null** | Already the trust gate; null on ambiguity. |
| `maxTxn` (abs) | max `|amount|` | **Magnitude yes; sign no** | Sign discarded → cannot detect offsets vs concentration (failure #2, #9). Needs a signed companion or an offset flag. |
| `sign(total)` | derived | **Yes** | But meaning depends on `accountType` (debit/credit convention). |
| `topVendor` | `firstDetailText` (first detail col) | **No, as built** | Pulls Reference/invoice/check before Vendor (failure #12). |
| `topVendorCount` | freq of `topVendor` | Only as reliable as `topVendor` | Dominance signal is sound once the column is correct. |
| per-row `detailText` | `firstDetailText` | Collapsed | Vendor / Description / Reference are merged to one string. |
| `account` (label) | base report | **Yes** | Already used by `descriptorFor`. |
| `accountType` | note | **Yes** | revenue/expense/unknown — **unused today**. |
| `category` | note | **Yes** | favorable/unfavorable/neutral — **unused today**. |
| `varianceAmount` | note | **Yes** | **The missing input.** |
| `variancePercent` | note | **Yes** | Secondary materiality signal. |
| `comparison` / `comparisonType` | note | **Yes** | Drives unbudgeted (D). |
| `confidence` | match score | **Yes** | 1.0 code / 0.9 name / 0.7 substring. |
| `thick` | match | **Yes** | amount/description present. |
| **Vendor (typed column)** | reconstructed GL `Vendor` idx | **Yes, if split out** | Clean alpha vendor name; needs match.js change (§6). |
| **Description (typed column)** | reconstructed GL `Description` idx | **Yes, if clean** | Short, alpha; render only when clean. |
| Reference / invoice / check | GL `Reference` idx | **No (default)** | IDs, never rendered by default. |
| Date | GL `Date` idx | **No (default)** | Never rendered by default. |
| filename | extraction | **Never** | Forbidden. |

**Reliable enough to render:** `count`, `total` (non-null), `maxTxn` (with an
offset guard), `varianceAmount`/direction (→ `R`), and — after the §6 split — a
**clean Vendor** and a **clean short Description**. Not renderable by default:
references/invoices/checks, dates, filenames, signed-vs-unsigned ambiguities.

---

## 3. Contribution Ranking Model (deterministic)

Add one pure step that runs **after** match selection and **before** category
templating, using only already-computed numbers.

**Definitions**
```
V  = |varianceAmount|                         (variance magnitude, from the note)
T  = total                                    (net GL sum; null ⇒ unreliable)
R  = isReliable(T) && V>0 ? |T| / V : null    (contribution ratio)
maxAbs = |maxTxn|
offset = isReliable(T) && maxAbs > |T| * OFFSET_FACTOR   (offsets/washing present)
dirExpected = expected sign of contributing net activity given accountType+category
dirConflict = isReliable(T) && sign(T) !== dirExpected
```

**Sign convention (`dirExpected`)** — GL amounts are debit-positive
(see `pdfTable.js`: debit − credit):
- **expense + unfavorable** (over budget) → expected net **> 0** (debits add cost).
- **expense + favorable** (under budget) → expected net **< 0** (credits/true-ups).
- **revenue + favorable** (revenue up) → revenue posts as credits → expected net **< 0**.
- **revenue + unfavorable** (revenue down) → expected net **> 0**.
- **unknown accountType** → `dirExpected = null` ⇒ `dirConflict = false` (never assert a conflict we can't ground).

**Proposed constants** (single source, new module; tune in QA):
```
ALIGN_LOW   = 0.5    // R in [0.5, 2.0] ⇒ aligned/direct
ALIGN_HIGH  = 2.0
DISPROP_HI  = 3.0    // R > 3.0 ⇒ too large (disproportionate)
PARTIAL_LO  = 0.25   // R < 0.25 ⇒ too small (partial)
OFFSET_FACTOR = 1.0  // maxAbs > |T| ⇒ offsetting entries present
```

**Ranking bands** (evaluated as a contribution *qualifier*, applied on top of the
existing 19A shape):

| Rule | Condition | Decision | Wording consequence | Fallback |
|---|---|---|---|---|
| **Aligned** | `0.5 ≤ R ≤ 2.0` | Contribution = **direct** | Render confident shape sentence (A/B/C/I/Direct) with total. | If `T` null → "partial-support" wording. |
| **Major single aligned** | aligned **and** `count` small / `ratio ≥ DOMINANCE` **and not** `offset` | **Major single contributor** | Render the single dominant amount. | If `offset` → drop maxTxn, use Direct. |
| **Too large** | `R > 3.0` | **Related but disproportionate** | Soften: "includes" not "shows"; **suppress the total figure** (or label "gross activity"); never imply it sizes the variance. | If also `offset`/credit → Direction/Insufficient. |
| **Too small** | `R < 0.25` | **Related but partial** | Qualify: "partially reflected in GL detail"; may state count, omit a total that looks like the whole story. | none (always safe to soften). |
| **Offsets present** | `maxAbs > |T|` | **Suppress maxTxn rendering** | Never render a single amount larger than the net total (kills failures #2, #9); optionally "includes offsetting entries". | Degrade to Direct/Insufficient. |
| **Direction conflict** | `dirConflict` | **Direction conflict / credit** | Explicitly frame as credit / true-up / reversal *against* the variance direction — not as spend. | If `accountType==unknown` → no conflict; treat by magnitude only. |
| **Revenue sign** | `accountType==revenue` | Use revenue `dirExpected` | Credit = normal income, not a true-up; flips E semantics. | unknown → magnitude-only. |
| **Mid bands** | `0.25 ≤ R < 0.5` or `2.0 < R ≤ 3.0` | **Qualified** | Hedged wording ("part of", "alongside other activity"); render figure but not as definitive. | none. |
| **Unreliable / thin** | `T` null, or `thick==false`, or `confidence` below band | **Insufficient explanatory support** | Count-only or "available for review"; no contribution claim. | terminal. |

Precedence (first wins): **Insufficient (gate) → Direction conflict → Offsets
guard → Too large → Too small → Mid → Aligned/Major/Recurring.** The 19A shape
(A/B/C/I) is then chosen *within* the aligned band only.

---

## 4. GL Detail Rendering Rules

**Allowed**
- **Vendor name** — only from the typed `Vendor`/`Payee`/`Name` column (post-§6
  split), only when **clean** and **dominant**:
  - clean = `/[A-Za-z]/.test(v)`, length 3–40, **not** all digits, **not**
    matching reference/invoice/check/doc patterns, no money/date tokens.
  - dominant = `topVendorCount / count ≥ VENDOR_DOMINANCE` (e.g. 0.5) or a single vendor.
- **Short description** — from the typed `Description` column, clean (alpha,
  ≤ ~40 chars, no IDs/amounts/dates) — rendered as a brief descriptor only.
- **Transaction amount** — only when **proportionate** (aligned/major band) and
  **not** under `offset`; always via `approxMoney()`.
- **count / total** — only when proportionate (suppressed or softened when `R>3` or `R<0.25`).

**Never (default)**
- Raw filenames, "Supporting file", debug/source language.
- Raw invoice / reference / check / doc IDs.
- Dates.
- Unsupported causal claims (Phase 17.1 forbidden list stays).
- Exact, unrounded, or re-quoted raw row amounts (`approxMoney()` only).
- Exact references unless an explicit later phase approves them.

A rendered vendor/description is **context only** ("…related to <Vendor>
activity…"), never "<Vendor> caused/drove the variance".

---

## 5. Proposed Commentary Categories

These layer the contribution ranking onto the 19A shapes. Internally, keep the
A–I shape codes and add a **contribution qualifier** so templates stay testable.

| Category | Rule (with §3 terms) | Template (current-period; YTD ⇒ "year-to-date") |
|---|---|---|
| **Direct contributor** | aligned (`0.5≤R≤2.0`), reliable `T`, not offset, not dirConflict | `… GL detail shows approximately {approxMoney(T)} of related {descriptor} activity {period}.` |
| **Major single contributor** | aligned, `count` small or `ratio≥0.80`, not offset | `… GL detail shows a single transaction of approximately {approxMoney(maxTxn)} {period}.` |
| **Related but disproportionate** | `R > 3.0` | `… GL detail includes substantially larger related activity {period}; only part is reflected in this variance.` *(no total figure, or "gross activity" qualifier)* |
| **Related but partial** | `R < 0.25` | `… GL detail shows approximately {approxMoney(T)} of related activity {period}, a portion of the total movement.` |
| **Direction conflict / credit** | `dirConflict` (sign opposes variance direction) | `… GL detail shows a net credit of approximately {approxMoney(|T|)} {period}, which runs counter to the variance direction and warrants review.` |
| **Routine recurring activity** | `3≤count≤12`, `ratio≤0.60`, aligned/partial | `… GL detail shows approximately {approxMoney(T)} across {count} recurring transactions {period}.` |
| **Insufficient explanatory support** | thin / low-confidence / `T` null / offset-dominated / unknown direction with `R` out of band | `… Detailed account activity was available for review.` *(or count-only)* |

**Examples**
- *Repairs, one $18k invoice, var $17k* (R≈1.06) → **Major single**: "… a single transaction of approximately $18,000 …".
- *Var $7,186, total $10,700, max $23,200* (offset) → **Insufficient/Direct, maxTxn suppressed**: "… related activity was available for review …" (never the $23,200 line).
- *Var $2,189, GL net −$265,000* (R≈121, credit) → **Disproportionate + Direction conflict**: "… GL detail includes substantially larger related credit activity; only part is reflected in this variance."
- *Var $40,000, total $1,800* (R=0.045) → **Related but partial**: "… approximately $1,800 of related activity, a portion of the total movement."
- *Unfavorable expense var +$8,000, GL net −$5,000* → **Direction conflict / credit**.
- *Revenue up $12k, GL net −$12k credit* (R≈1.0) → **Direct contributor** (revenue convention: credit = normal income, NOT flagged as a conflict).

`H` (no GL citation) stays: note returned unchanged (identity preserved).

---

## 6. Architecture Recommendation

**Recommendation: a new evidence-ranking module + a small, surgical `match.js`
change.** Do not overload `classify.js`.

| File | Change | Responsibility |
|---|---|---|
| `src/lib/enrich/match.js` | **MODIFY (prerequisite)** | Split detail columns: `VENDOR_COL_RE` (`vendor\|payee\|name`), `DESC_COL_RE` (`description\|memo\|detail\|narrative\|note\|particular`), `REF_COL_RE` (`reference\|ref\|invoice\|doc\|check`). Carry `vendorText` / `descText` per entry. `summarizeDetail` exposes `topVendor` from the **Vendor column only**, plus `vendorClean` (passes §4 cleanliness) and `topDescription`. **Keep `maxTxn`; add `signedMax` (or `hasOffset = maxAbs > |total|`)** so offsets are detectable. Backward-compatible: existing fields keep their meaning; `total` null-gating unchanged. |
| `src/lib/enrich/contribution.js` | **NEW** | `rankContribution({ varianceAmount, accountType, category, detail })` → `{ R, band, offset, dirConflict, contribution }`. Pure, holds the §3 constants. No I/O. |
| `src/lib/enrich/classify.js` | **MODIFY** | Accept the contribution result; gate/override the shape: Insufficient/Direction/Offset/Disproportionate/Partial take precedence over A–I. Keep existing constants; add no vendor logic here. |
| `src/lib/enrich/templates.js` | **MODIFY** | Add contribution-aware builders + optional clean-vendor/description rendering (still `approxMoney`, `descriptorFor`, no causation). |
| `src/lib/enrich/index.js` | **MODIFY** | In `enrichNote`, pass `note.varianceAmount`, `note.accountType`, `note.category` into the ranker before templating. Identity / non-GL paths untouched. Re-export new symbols. |

**Does `match.js` need changes to preserve vendor/description rows?** **Yes —
this is the key dependency.** Today `match.js` already *keeps* every matched row
(`rows` Map, deduped by sourceRow) and reads detail columns, but
`firstDetailText` **collapses Vendor/Description/Reference to a single string and
prefers Reference by column order**, so a clean vendor is unrecoverable
downstream (failure #12). The rows themselves are preserved; what's missing is
**column-typed propagation**. The change is additive (new typed fields on each
entry + new summary fields), so no existing test of `total`/`count`/`maxTxn`/
identity should break. No changes outside `src/lib/enrich/` (+ tests).

`varianceAmount`, `accountType`, `category` already flow to the note via
`sections.toNote()` — **no `sections.js`/variance changes needed** to feed `R`.

---

## 7. QA Plan

**Synthetic unit tests** (`test/contribution.test.js`, `test/classify.test.js`)
- Ratio bands: `R = 0.1, 0.24, 0.25, 0.5, 1.0, 2.0, 3.0, 3.1, 121` → expected band.
- Offset guard: `maxAbs > |total|` ⇒ maxTxn never rendered; both #2 and #9 inputs.
- Direction: expense+unfavorable+negative total ⇒ conflict; expense+favorable+negative ⇒ no conflict; revenue+favorable+negative ⇒ Direct (no conflict); unknown ⇒ no conflict asserted.
- Unreliable: `total=null` with a clean single charge ⇒ count/partial wording, never a fabricated R.
- Vendor split: Reference value must **not** surface as vendor; clean Vendor renders; dirty/ID vendor suppressed; dominance threshold.
- Purity: identical inputs ⇒ identical `{band, contribution}` and identical string.

**Real MRI report validation** (`test/realReportQA.test.js`, extends the existing
MRI-layout fixtures in `enrich.test.js`/`pdfGL.test.mjs`)
- Run the real stacked-header MRI GL fixtures (`54110 Real Estate Taxes`, `51101
  Fire Sprinkler`, the `WIP Capital Improvements` ambiguous-amount row) through
  the full pipeline; assert each lands in a defensible band and that the
  `AP 064697`-style reference never renders while `ONE WORKPLACE`-style vendors
  may. Reuse the §1 numbers ($7,186/$23,200; $2,189/−$265,000) as fixtures.

**Before/after examples** — table asserting each §1 failure now renders the §5
replacement (e.g. #1 no longer states "$265,000" as context; #2 drops the
$23,200 line).

**Owner-readability scoring** — a rubric (0–3) applied to a sample: (a) is the
GL figure relatable to the variance? (b) any unreconcilable third number? (c)
would an owner over- or under-attribute? Target: mean ≥ 2.5, zero "0" scores.
Implement as a deterministic checklist over the rendered strings, not a model.

**Safety checks (extend `FORBIDDEN` sweep + AC-3/AC-4)**
- No reference/invoice/check ID, date, filename, or causal phrase in any rendered line.
- **No rendered single amount exceeds the rendered total** (offset guard).
- **No rendered GL figure when `R > DISPROP_HI`** (disproportionate suppression).
- Every figure is `approxMoney()`-rounded; base variance figure preserved exactly.
- Base-only / no-match output **byte-identical** (AC carried from 19A).

---

## 8. Recommendation

**Phase 19B — ready to build**, with one explicit prerequisite sub-task.

- The core gap is well-defined and fixable with already-computed numbers:
  `classifyGLCommentary` simply never sees `varianceAmount`/`accountType`/
  `category`. Wiring those in via a pure `contribution.js` ranker is low-risk,
  fully deterministic, and additive.
- **Prerequisite within 19B:** the `match.js` vendor/description **column split**
  (§6) is required for *both* (a) rendering a clean vendor and (b) eliminating
  the reference-ID-as-vendor leak. It is small and backward-compatible; do it
  first, behind the existing `summarizeDetail` shape.
- Do **not** revise Phase 19A — its shape categories (A/B/C/I/E) are correct
  *within* the aligned band; 19B layers contribution gating on top rather than
  replacing them. Defer is unwarranted: failures #1–#3 are actively
  owner-misleading on real MRI output today.

**Sequencing:** (1) `match.js` typed-detail split + offset signal →
(2) `contribution.js` ranker + constants → (3) `classify.js` precedence gates →
(4) `templates.js` contribution-aware + clean-vendor builders →
(5) QA per §7. Touches only `src/lib/enrich/` and `test/`.

**Stop. Spec only — no Phase 19B code, no production-code changes, no branch, no merge.**
