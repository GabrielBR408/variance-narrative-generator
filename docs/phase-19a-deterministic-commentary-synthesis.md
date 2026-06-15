# Phase 19A — Deterministic Commentary Synthesis
**Implementation Specification (revised — PM revisions applied 2026-06-15)**

Repo: `variance-narrative-generator` · Base: `main @ 4902a69` (Phase 18A merged)
Branch: `claude/phase-19a-deterministic-commentary-synthesis`
Authority: ChatGPT owns PM / architecture / QA · Claude owns implementation
Status: **Pre-build spec. Not implemented. No production code. No merge.**

> Revision note (this version): confidence-band model replaces the single
> `HIGH_CONFIDENCE = 0.90` gate; recurrence is now ratio-based (vendor frequency
> dropped); Category **D** rewritten; Category **I** (Concentrated activity)
> added; real-report QA release targets added.

---

## 0. Grounding (what exists today)

Established by reading the codebase:

- Enrichment runs **after** the base narrative, in `src/lib/enrich/`, pure and deterministic (no AI, no network).
- `match.js → summarizeDetail()` already produces the evidence we are allowed to use, per matched GL file:
  `{ count, total, maxTxn, topVendor, topVendorCount }` — `total` is **`null` whenever amounts are ambiguous** (e.g. Debit+Credit), so a present `total` is trustworthy.
- Each variance note (`sections.js → toNote()`) carries: `account`, `category`, `accountType`, `comparisonType`, `varianceAmount`, `variancePercent`, `actual`, `comparison`.
- After `enrichNote()` a note also carries `support[]` with `{ classificationType, confidence, thick, detail }`. `confidence` tiers from `scoreMatch`: `1.0` code, `0.9` name, `0.7` substring; `CONFIDENCE_FLOOR = 0.6`.
- The **generic line being targeted** is `templates.js → glEvidenceSentence()` Tier 1:
  `"GL detail shows approximately $X of related activity during the period."`
- **Critical invariant (must survive):** with no supporting files or no confident match, `enrichNarrative` returns the *same object reference* → base-only output is byte-identical (`enrich.test.js:97`).
- `approxMoney()` rounding and the Phase 17.1 **no-causation** rule stay.

The fix slots a **classifier** between the already-computed evidence (`detail`) and the template, replacing the one-size line with a category-specific, owner-ready sentence — using only fields that already exist.

---

## 1. Phase Scope

### In scope
- A deterministic **commentary classifier** for **GL-primary** enriched notes mapping existing evidence + variance fields to one of 9 categories (A–I, where H = no evidence).
- New **per-category templates** (short, owner-ready, no causation).
- Wiring the classifier into `enrichNote()` so GL evidence renders the classified sentence instead of the bare generic line.
- Unit + integration + real-report QA, including the **generic-reduction metric** and the **release targets** in §5.

### Out of scope (explicitly unchanged)
- Extraction, matching, scoring, confidence floor, variance math, thresholds, period scope, exports, supporting-file authority model.
- **Non-GL** evidence wording (`explanationClause` for budget/prior/variance/other).
- Base-only narratives — must stay byte-identical (classifier runs only on notes that already received a GL citation).
- Rendering of raw vendor strings, dates, reference/invoice IDs, filenames (Risk §6).

### Acceptance criteria
1. **AC-1 (primary target):** generic-line usage on the GL QA corpus drops by **≥70%** vs the Phase 18A baseline; equivalently ≥70% of reliable-total GL notes route to a specific category (A/B/C/D/E/I).
2. **AC-2:** base-only and no-match output remain **byte-identical**.
3. **AC-3:** no rendered commentary contains any Phase 17.1 forbidden phrase, filename, date, reference/invoice ID, or raw vendor token.
4. **AC-4:** every dollar figure rendered is the preserved base variance figure or an `approxMoney()`-rounded aggregate — no new exact/unrounded figures, no re-quoted raw row amounts.
5. **AC-5:** Markdown/DOCX parity preserved (identical bullets, same order).
6. **AC-6:** classifier is pure: same inputs → same category and same string.
7. **AC-7:** release targets in §5 met on the expanded real-report QA corpus.

---

## 2. Commentary Types

Notation: `total`, `count`, `maxTxn`, `topVendor`, `topVendorCount` from `detail`; `comparison`, `category`, `accountType` from the note; `confidence`, `thick` from the primary GL citation. Period rendered via existing `periodSuffix(period)` (examples below show the current-period form; YTD substitutes "year-to-date"). `descriptorFor(account)` reused for "related {descriptor} activity". `reliableTotal = typeof total === 'number' && isFinite(total) && total !== 0`. `ratio = maxTxn / Math.abs(total)` (only defined when `reliableTotal`).

Constants (single source, in `classify.js`):
`CONF_G_MAX = 0.70` · `CONF_AE_MIN = 0.85` · `DOMINANCE_RATIO = 0.80` · `RECURRING_MAX_RATIO = 0.60` · `RECURRING_MIN_COUNT = 3` · `CONCENTRATED_MIN_RATIO = 0.60`.

**Confidence bands (revised):**
- `confidence < 0.70` → **G**
- `0.70 ≤ confidence < 0.85` → **F only** (if `thick && reliableTotal`; else **G**)
- `confidence ≥ 0.85` → **A–E and I eligible**

---

### A — One-time
- **Inputs:** `count`, `total`, `confidence`.
- **Rule:** `confidence ≥ 0.85` AND `count === 1`.
- **Template (reliable total):** `GL detail shows a single transaction of approximately {approxMoney(total)} {period}.`
- **Template (no total):** `GL detail shows a single related transaction {period}.`
- **Fallback:** not `count===1` → B/C/I/F.

### B — One-time-dominated
- **Inputs:** `count`, `total`, `maxTxn`, `confidence`.
- **Rule:** `confidence ≥ 0.85` AND `count > 1` AND `reliableTotal` AND `ratio ≥ 0.80`.
- **Template:** `GL detail shows approximately {approxMoney(total)} across {count} transactions, with one of about {approxMoney(maxTxn)} {period}.`
- **Fallback:** ratio < 0.80 → C/I/F; no reliable total → C/I/F.

### C — Recurring
- **Inputs:** `count`, `total`, `maxTxn`, `confidence`.
- **Rule (revised — ratio-based, vendor frequency dropped):** `confidence ≥ 0.85` AND `count ≥ 3` AND `reliableTotal` AND `ratio ≤ 0.60`.
- **Template:** `GL detail shows approximately {approxMoney(total)} across {count} recurring transactions {period}.`
- **Note:** `topVendor`/`topVendorCount` are **not** used by the classifier or rendered.
- **Fallback:** → F (recurrence cannot be detected without a reliable total).

### D — Unbudgeted
- **Inputs:** `comparison`, `total`, `confidence`.
- **Rule:** `confidence ≥ 0.85` AND (`comparison === 0 || comparison == null`). Renders only when a GL citation is present (preserves base-only identity).
- **Template (reliable total, revised):** `Activity occurred without a budget allocation; GL detail shows approximately {approxMoney(total)} {period}.`
- **Template (no total, revised):** `Activity occurred without a budget allocation and should be reviewed for future forecasting.`
- **Boundary:** no recommendation language beyond forecasting; no causation.
- **Fallback:** → A/B/C/I/F (only the unbudgeted qualifier is dropped).

### E — Credit / true-up
- **Inputs:** `total` (sign), `count`, `confidence`.
- **Rule:** `confidence ≥ 0.85` AND `reliableTotal` AND `total < 0`.
- **Template (single):** `GL detail shows a single credit of approximately {approxMoney(|total|)} {period}.`
- **Template (multiple):** `GL detail shows net credits of approximately {approxMoney(|total|)} across {count} transactions {period}.`
- **Fallback:** `total ≥ 0` or not reliable → A/B/C/I/F.

### F — Quantified fallback
- **Inputs:** `total`, `count`, `confidence`, `thick`.
- **Rule:** thick evidence matching none of A–E/I. Two confidence bands:
  - `confidence ≥ 0.85`, `reliableTotal`, `count > 1`, not dominated, not recurring, not concentrated → quantified-with-count.
  - `0.70 ≤ confidence < 0.85`, `thick`, `reliableTotal` → **F is the ceiling** (no A–E/I claims at moderate confidence; Risk §6).
- **Template (reliable total):** `GL detail shows approximately {approxMoney(total)} across {count} related {descriptor} transactions {period}.`
- **Template (no total):** `Detailed activity includes {count} related transactions {period}.`
- **Fallback:** → G.

### G — Low-confidence
- **Inputs:** `thick`, `confidence`.
- **Rule:** GL citation present but `thick === false`, OR `confidence < 0.70`, OR `0.70 ≤ confidence < 0.85` with no reliable total.
- **Template:** `Detailed account activity was available for review.`
- **Fallback:** → H.

### H — No evidence
- **Inputs:** `support` absence.
- **Rule:** no GL citation for the note.
- **Template:** none — **note returned unchanged** (identity preserved; a non-GL clause may still apply via the existing path).

### I — Concentrated activity *(new)*
- **Inputs:** `count`, `total`, `maxTxn`, `confidence`.
- **Rule:** `confidence ≥ 0.85` AND `count === 2` AND `reliableTotal` AND `ratio ≥ 0.60` AND not one-time (`count !== 1`).
- **Template:** `GL detail shows approximately {approxMoney(total)} across two related transactions {period}.`
- **Precedence note:** B outranks I, so a `count === 2` line with `ratio ≥ 0.80` renders as B; I covers `count === 2` with `0.60 ≤ ratio < 0.80`.
- **Fallback:** → F.

---

## 3. Decision Tree (deterministic order)

Runs **only** when `enrichNote` has selected a **GL** primary citation. Evaluate top-down; **first match wins; exactly one category per note.**

```
0.  no GL citation ........................................ → H  (note unchanged)
1.  primary.thick === false ............................... → G
2.  confidence < 0.70 ..................................... → G
3.  0.70 <= confidence < 0.85:
        reliableTotal ..................................... → F   (quantified ceiling)
        else .............................................. → G
4.  confidence >= 0.85:
    a. comparison === 0 || comparison == null ............ → D
    b. reliableTotal && total < 0 ....................... → E
    c. count === 1 ....................................... → A
    d. count > 1 && reliableTotal && ratio >= 0.80 ....... → B
    e. count >= 3 && reliableTotal && ratio <= 0.60 ...... → C
    f. count === 2 && reliableTotal && ratio >= 0.60 ..... → I
    g. otherwise ......................................... → F
```

`ratio = maxTxn / |total|`. The 0.60–0.80 band for `count >= 3` (neither dominated nor recurring) falls to F; `count === 2` with `ratio < 0.60` (two roughly equal transactions) falls to F.

### Precedence rationale
- **Evidence gating first (0–3):** match quality and amount reliability bound everything. A weak/thin match or moderate confidence can never produce a pattern claim — the core false-precision guard.
- **D before E/A/B/C/I:** "unbudgeted" is a *structural* fact about the variance; the GL amount becomes its supporting tail.
- **E before pattern categories:** a net credit is a *sign/direction surprise* — the most consequential thing to mis-state.
- **A → B → C → I → F:** decreasing structural strength; F is the residual quantified catch-all.

### Conflict resolution
- Unbudgeted + credit → **D** (structural precedence).
- `count === 2`, `ratio ≥ 0.80` → **B** (B outranks I).
- Dominated + recurring inputs collide only when `count >= 3`; B (`ratio ≥ 0.80`) and C (`ratio ≤ 0.60`) are disjoint, so no tie.
- `total` unreliable disables B, C, E, I (all need a signed magnitude/ratio); the note degrades to A (count 1) or F (count form).
- Moderate confidence (0.70–0.85) hard-caps at **F** regardless of shape.

---

## 4. Architecture

```
computeVariance (UNCHANGED)
      │  variance records
      ▼
generateNarrative / sections.toNote (UNCHANGED)
      │  note { account, category, accountType, comparison,
      │         varianceAmount, variancePercent, actual }
      ▼
enrich/index.js · enrichNote (MODIFIED)
      │  matchAccount → support[] (+ detail summary)  [match.js UNCHANGED]
      │  pick GL primary  ──────────────────────────────┐
      ▼                                                  │
enrich/classify.js · classifyGLCommentary (NEW) ◄────────┘
      │  → { type: 'A'..'I' }   (pure, deterministic)
      ▼
enrich/templates.js · commentarySentence (NEW builders) (MODIFIED)
      │  → owner-ready string (approxMoney, periodSuffix, descriptorFor)
      ▼
appendSentence (UNCHANGED)  →  note.text
      ▼
export/markdown.js · export/docx.js (UNCHANGED)  →  render
```

### Files
| File | Change | Responsibility |
|---|---|---|
| `src/lib/enrich/classify.js` | **NEW** | `classifyGLCommentary({ detail, comparison, confidence, thick })` → `{ type }`. Holds the constants and the §3 tree. Pure, no I/O. |
| `src/lib/enrich/templates.js` | **MODIFY** | Add `commentarySentence({ type, account, detail, period })` dispatching to per-category builders (A–G, I). Keep `glEvidenceSentence` as the F/legacy fallback; reuse `approxMoney`, `periodSuffix`, `descriptorFor`. No causation, no vendor/date/ref rendering. |
| `src/lib/enrich/index.js` | **MODIFY** | In `enrichNote`, when `isGL(primary)`, call `classifyGLCommentary` then `commentarySentence`; `type === 'H'` returns the note unchanged. Non-GL path and identity short-circuit untouched. Re-export new symbols. |
| `test/classify.test.js` | **NEW** | Unit coverage of the tree and every band/ratio boundary. |
| `test/enrich.test.js` | **MODIFY** | Update GL expectation strings; add an integration case per category. Identity / forbidden-phrase / parity tests stay. |
| `test/realReportQA.test.js` | **MODIFY** | Expand the GL corpus; add the §5 release-target assertions and the AC-1 generic-reduction metric. |

No new dependencies. No changes outside `src/lib/enrich/` and `test/`.

---

## 5. Test Plan & Release Targets

### Unit (`test/classify.test.js`)
- **Confidence bands:** `0.69 → G`; `0.70 + thick + reliable → F`; `0.70 + no total → G`; `0.84 → F`; `0.85 → A–E/I eligible`.
- **A:** `count 1` (with/without total).
- **B:** `count 4, ratio 0.85 → B`; `ratio 0.79 → not B`.
- **C:** `count 5, ratio 0.50 → C`; `count 5, ratio 0.70 → F`; `count 2, ratio 0.50 → F` (count<3).
- **I:** `count 2, ratio 0.70 → I`; `count 2, ratio 0.85 → B` (precedence); `count 2, ratio 0.55 → F`.
- **D:** `comparison 0` and `comparison null` → D (overrides E/A/B/C/I); no-total form.
- **E:** `total -7400, count 1 → E single`; `count 3 → E multiple`; `total +7400 → not E`.
- **F:** `count 3, ratio 0.70 → F` (mid-band gap).
- **Conflict matrix:** unbudgeted+credit→D; count2 ratio0.85→B; unreliable total disables B/C/E/I.
- **Purity:** identical input twice → identical `{type}` and rendered string.

### Integration (`test/enrich.test.js`)
- Each category renders its exact sentence appended after the preserved base variance sentence.
- **AC-2:** identity tests pass unchanged.
- **AC-3:** `FORBIDDEN` sweep extended — no filename, date-like token, `topVendor` string, or reference/invoice digits leak.
- **AC-4:** money-count assertion extended to A/B/E/I (which add `maxTxn`/`|total|`).
- **AC-5:** Markdown/DOCX bullet parity across all categories.
- Period-aware (`ytd` → "year-to-date") for representative categories.

### Real-report QA (`test/realReportQA.test.js`)
The GL corpus is expanded to a representative synthetic set large enough to exercise every category, then the pipeline is classified and asserted against the release targets below.

**Release targets (must all hold on the QA corpus):**

| Metric | Target |
|---|---|
| Category A count | ≥ 5 |
| Category B count | ≥ 5 |
| Category C count | ≥ 10 |
| Category D count | ≥ 3 |
| Category E count | ≥ 1 |
| Category F share | ≤ 30% of GL-enriched notes |
| Category G count | no increase vs Phase 18A baseline |
| Generic-line reduction | ≥ 70% vs Phase 18A baseline |

> Corpus implication: the expanded QA fixture needs ≥ ~24 GL-enriched notes
> spanning one-time, dominated, recurring, concentrated, credit, and unbudgeted
> shapes to satisfy the per-category minimums. Building this fixture is part of
> the Phase 19A QA work, not a production change.

### Target examples (owner-ready)
| Scenario | Rendered tail |
|---|---|
| Repairs, one $18k invoice | `… GL detail shows a single transaction of approximately $18,000 during the current period.` |
| Utilities, $7.4k / 12 charges, biggest $6.3k | `… GL detail shows approximately $7,400 across 12 transactions, with one of about $6,300 during the current period.` |
| Landscaping, $9k / 12 even charges | `… GL detail shows approximately $9,000 across 12 recurring transactions during the current period.` |
| Two related charges, $9k, biggest $6k | `… GL detail shows approximately $9,000 across two related transactions during the current period.` |
| New line, no budget, $5k activity | `… Activity occurred without a budget allocation; GL detail shows approximately $5,000 during the current period.` |
| New line, no budget, ambiguous amounts | `… Activity occurred without a budget allocation and should be reviewed for future forecasting.` |
| Insurance refund, net −$3k | `… GL detail shows a single credit of approximately $3,000 during the current period.` |

---

## 6. Risk Review

### Hallucination risks
- **Vendor-string leakage (highest).** `detail.topVendor` is sourced from `DETAIL_COL_RE`, which matches `reference|ref|invoice|doc|check` columns — the "top vendor" can be an invoice ID or check number. **Mitigation: Phase 19A does not use vendor frequency at all and never renders the vendor token** (recurrence is now ratio-based).
- **No semantic inference.** Categories derive purely from counts/sums/signs already computed; `descriptorFor` is the only label source (base-account-name only, already shipped).

### False-precision risks
- **Moderate-confidence pattern claims.** A 0.70–0.85 match asserting a shape compounds match uncertainty with shape uncertainty. **Mitigation: that band hard-caps at F.**
- **Ratio thresholds.** `0.80` (dominated) / `0.60` (recurring & concentrated) are conservative; the 0.60–0.80 gap for `count ≥ 3` degrades to F (correct, less specific) — never a wrong claim.
- **Ambiguous totals.** B/C/E/I require a reliable signed `total`; when `total` is `null` they are disabled, so no magnitude/ratio is invented. `approxMoney` rounding prevents fabricated exactness.

### Readability risks
- **Sentence length (B).** Two amounts + a count; kept to one clause. If QA finds it heavy, drop `maxTxn` — flag to ChatGPT, do not change silently.
- **D vs base sentence redundancy.** For `comparison === 0` the base line already reads "exceeded budget by $X"; D adds the unbudgeted note. Base templates are out of scope and unchanged.
- **Category drift.** All thresholds are named constants in `classify.js` for one-line tuning.

---

## 7. Implementation Readiness Recommendation

**Ready to implement — pending nothing further from this revision.**

- All PM revisions are incorporated: confidence-band model (`<0.70 → G`, `0.70–0.85 → F`, `≥0.85 → A–E/I`), ratio-based recurrence (vendor frequency removed), rewritten Category D (forecasting-only language), new Category I (concentrated), and the §5 release targets.
- The work is fully supported by already-computed evidence; it adds a pure classifier + templates and touches only `src/lib/enrich/` and `test/`.
- **One build-time dependency to confirm during QA, not blocking spec sign-off:** the real-report QA fixture must be expanded to ≥ ~24 GL-enriched notes to satisfy the per-category minimums (A ≥5, B ≥5, C ≥10, D ≥3, E ≥1). This is QA fixture work, not production change.
- **Firm guardrail carried forward:** no raw vendor strings, dates, reference/invoice IDs, or filenames are ever rendered.

**Stop. Spec only — no Phase 19A code, no production-code changes, no merge.**
