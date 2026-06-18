// Reviewed-notes feedback regression tests — NQ-2B.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// These encode the most common reviewer feedback on the generated commentary,
// as small, safe narrative rules layered on top of NQ-2A.1 (detailed mode only;
// conservative mode is unchanged). Each test maps to a reviewed-note scenario:
//   1/2. vendor / service detail PREFERRED over generic offset/timing language
//        (Janitorial Contract, Security Contract, HVAC Contract boilerplate).
//   3.   zero-actual budgeted lines get a clear factual statement.
//   4.   material variances with NO supporting detail are flagged for review,
//        never speculated about (Fire/Life Safety material unexplained).
//   5.   negative actuals / opposite-direction activity call out credit/reversal.
//   6.   operationally immaterial (tiny dollar) variances get no commentary.
// Always preserved: numeric integrity, ≤ 2 sentences, no certainty language.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  enrichNarrative,
  zeroActualCommentary,
  negativeActualCommentary,
  isMaterialVariance,
  isImmaterialVariance,
  MATERIAL_DOLLAR
} from '../src/lib/enrich/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'

// --- helpers ---------------------------------------------------------------

function rec({ account, actual, budget, accountType = 'expense', category = 'unfavorable' }) {
  const varianceAmount = actual - budget
  const variancePercent = budget === 0 ? null : (varianceAmount / Math.abs(budget)) * 100
  return {
    account, actual, budget, prior: null, varianceAmount, variancePercent,
    comparisonType: 'budget', thresholdTriggered: true, category, accountType,
    missingData: false, confidence: 90, sourceRows: [0]
  }
}

const GL_COLUMNS = ['Account', 'Date', 'Reference', 'Vendor', 'Description', 'Amount']

// Enrich a one-account flagged narrative. `rows` are GL [description, amount]
// pairs (vendor column left empty, so vendor/memo are mined from the dirty
// Description blob — the real MRI shape). With `rows` omitted, a non-matching GL
// is supplied so the note is unmatched but the enrichment pass still runs.
function enriched({ account, actual, budget, accountType, category, rows, mode = 'detailed' }) {
  const narrative = generateNarrative({
    fileId: 'base', fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report', thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{ period: 'current', comparisons: [rec({ account, actual, budget, accountType, category })] }]
  })
  const gl = {
    fileName: '4. General Ledger.pdf', status: 'ok', classification: { type: 'General Ledger (GL)' },
    normalized: {
      columns: GL_COLUMNS,
      rows: rows
        ? rows.map(([d, a]) => [account, '01/10/2026', '', '', d, String(a)])
        : [['ZZZ Unrelated', '01/10/2026', '', '', 'Nothing', '1']]
    }
  }
  const out = enrichNarrative(narrative, { supporting: [gl], mode })
  const p = out.periods[0]
  return p.highVariances.find((x) => x.account === account) ||
    p.revenueNotes.find((x) => x.account === account) ||
    p.expenseNotes.find((x) => x.account === account)
}

function sentenceCount(text) {
  return (String(text).match(/[.!?](?:\s|$)/g) || []).length
}

// Certainty / causation guard (mirrors the engine's reject net).
const FORBIDDEN = [
  /\bdue to\b/i, /caused by/i, /driven by/i, /\bdrove\b/i, /because of/i,
  /resulting from/i, /attributable to/i, /\bwill\b/i, /\bcertainly\b/i,
  /\bdefinitely\b/i, /\bmust\b/i
]
function assertSafe(text) {
  assert.ok(sentenceCount(text) <= 2, `>2 sentences: ${text}`)
  for (const re of FORBIDDEN) assert.doesNotMatch(text, re, `forbidden phrase ${re} in: ${text}`)
}

// --- 1/2. vendor / detail preference over generic offset language ----------

// NQ-5B (refined): OFFSET_TIMING lines that carry a render-safe vendor/memo keep
// the NQ-2B vendor-led wording — diagnosis improves weak text, it does not erase
// strong evidence. (The generic owner copy applies only to subjectless lines.)
test('Janitorial Contract: vendor/service detail is preserved (NQ-5B)', () => {
  const note = enriched({
    account: '51200 Janitorial Contract', actual: 9000, budget: 5000,
    rows: [['Janitorial contract TRINITY BUILDING SERVICES', 12000]] // GL > variance → offset shape
  })
  assert.match(note.text, /Janitorial contract from Trinity Building Services appears in the account detail/)
  assert.doesNotMatch(note.text, /Related account activity appears broader/)
  assertSafe(note.text)
})

test('Security Contract: vendor/service detail is preserved (NQ-5B)', () => {
  const note = enriched({
    account: '51100 Security Contract', actual: 9000, budget: 3000,
    rows: [['Security monitoring ARMADA SECURITY', 15000]]
  })
  assert.match(note.text, /Security monitoring from Armada Security appears in the account detail/)
  assert.doesNotMatch(note.text, /Related account activity appears broader/)
  assertSafe(note.text)
})

test('HVAC Contract: vendor/service detail is preserved (NQ-5B)', () => {
  const note = enriched({
    account: '51300 HVAC Contract', actual: 8000, budget: 5000,
    rows: [['HVAC maintenance BAY CITY MECHANICAL', 13000]]
  })
  assert.match(note.text, /HVAC maintenance from Bay City Mechanical/)
  assert.doesNotMatch(note.text, /Related account activity appears broader/)
  assertSafe(note.text)
})

// --- 3. zero-actual / 100%-under-budget lines ------------------------------

// NQ-5B: zero-actual budgeted lines diagnose TIMING_PHASING (no subject), so
// detailed mode renders the timing owner sentence in place of the NQ-2B factual
// statement.
const TIMING_PHASING_RE = /Budgeted activity did not post during the period, suggesting a timing difference or deferred work rather than permanent savings\.$/

test('zero-actual expense line → TIMING_PHASING diagnosis wording (NQ-5B)', () => {
  const note = enriched({ account: '51500 Window Cleaning', actual: 0, budget: 19000 })
  assert.match(note.text, TIMING_PHASING_RE)
  assertSafe(note.text)
})

test('zero-actual revenue line → TIMING_PHASING diagnosis wording (NQ-5B)', () => {
  const note = enriched({
    account: '40100 Rental Income-Storage', actual: 0, budget: 200,
    accountType: 'revenue', category: 'unfavorable'
  })
  assert.match(note.text, TIMING_PHASING_RE)
  assertSafe(note.text)
})

test('zero-actual TIMING_PHASING wording stays causation-free (supersedes NQ-2B no-speculation)', () => {
  const note = enriched({ account: '51500 Window Cleaning', actual: 0, budget: 19000 })
  // NQ-5B adds a tentative timing implication here; it must still carry no causal /
  // certainty language and stay within two sentences.
  assert.match(note.text, /suggesting a timing difference or deferred work rather than permanent savings\.$/)
  assertSafe(note.text)
})

// --- 4. material unexplained variance --------------------------------------

test('Fire/Life Safety: material variance with no detail is flagged for review, not guessed', () => {
  // $15,000 unfavorable, no GL match → material + unexplained.
  const note = enriched({ account: '51600 Fire/Life Safety-Other', actual: 20000, budget: 5000 })
  assert.match(note.text, /This is a material variance and should be reviewed with supporting detail\.$/)
  // It must not speculate about a cause.
  assert.doesNotMatch(note.text, /appears|recurring|offset|timing|reflects/i)
  assertSafe(note.text)
})

test('an immaterial unexplained variance is NOT flagged for review (no over-flagging)', () => {
  // $3,000 < material floor, no GL match → no commentary added (S1 only).
  const note = enriched({ account: '51700 Small Repair', actual: 8000, budget: 5000 })
  assert.doesNotMatch(note.text, /material variance and should be reviewed/)
  assert.equal(sentenceCount(note.text), 1)
})

// --- 5. negative / credit lines --------------------------------------------

// NQ-5B: a net-credit line with NO supporting detail (no subject) diagnoses
// ACCRUAL_TRUEUP and renders the safer-default owner sentence — never "moved
// opposite", which is reserved for an actual direction conflict.
const ACCRUAL_TRUEUP_RE = /Recorded activity appears consistent with accrual timing, reversals, or correcting entries rather than recurring operating activity\.$/

test('negative actual (no detail) → ACCRUAL_TRUEUP owner wording (NQ-5B)', () => {
  const note = enriched({
    account: '52000 Contra Expense', actual: -3000, budget: 1000, category: 'favorable'
  })
  assert.match(note.text, ACCRUAL_TRUEUP_RE)
  assert.doesNotMatch(note.text, /moved opposite|ran opposite/)
  assertSafe(note.text)
})

test('a GL direction conflict with a safe subject preserves the legacy reversal wording (NQ-5B)', () => {
  // Reported variance is OVER budget, but the GL nets negative — a real direction
  // conflict. The render-safe memo subject ("Premium charge") keeps the legacy
  // sentence, which legitimately says "ran opposite" because the GL did.
  const note = enriched({
    account: '51800 Insurance Premiums', actual: 8000, budget: 5000, category: 'unfavorable',
    rows: [['Premium charge', 2000], ['Premium credit', -8000]]
  })
  assert.match(note.text, /ran opposite to the reported movement, consistent with credits or reversals/)
  assertSafe(note.text)
})

// --- 6. immaterial line suppression ----------------------------------------

test('a tiny-dollar variance gets no detailed commentary (S1 only)', () => {
  // $22.64 / 37.7% — flagged by percent, but operationally immaterial.
  const note = enriched({
    account: '53000 Postage', actual: 60, budget: 82, accountType: 'expense', category: 'favorable',
    rows: [['Postage', 22]]
  })
  assert.equal(sentenceCount(note.text), 1, `expected S1 only, got: ${note.text}`)
})

test('a small-dollar but very-high-percent variance still gets commentary', () => {
  // Below the dollar floor but a >200% swing — not suppressed.
  assert.equal(isImmaterialVariance({ varianceAmount: 86, variancePercent: 214 }), false)
  assert.equal(isImmaterialVariance({ varianceAmount: 22, variancePercent: 37 }), true)
  assert.equal(isImmaterialVariance({ varianceAmount: 150, variancePercent: 5 }), false)
})

// --- pure-helper unit guards ------------------------------------------------

test('zeroActualCommentary only fires for actual = 0 against a positive budget', () => {
  assert.equal(zeroActualCommentary({ comparisonType: 'budget', actual: 0, comparison: 100, accountType: 'expense' }),
    'No service or expense was recorded in the period.')
  assert.equal(zeroActualCommentary({ comparisonType: 'budget', actual: 0, comparison: 100, accountType: 'revenue' }),
    'No activity posted against the budgeted amount.')
  assert.equal(zeroActualCommentary({ comparisonType: 'budget', actual: 5, comparison: 100 }), null)
  assert.equal(zeroActualCommentary({ comparisonType: 'budget', actual: 0, comparison: 0 }), null) // unbudgeted, not zero-actual
  assert.equal(zeroActualCommentary({ comparisonType: 'prior', actual: 0, comparison: 100 }), null)
})

test('negativeActualCommentary only fires for a negative actual', () => {
  assert.match(negativeActualCommentary({ actual: -1 }), /net credit or reversal/)
  assert.equal(negativeActualCommentary({ actual: 0 }), null)
  assert.equal(negativeActualCommentary({ actual: 10 }), null)
})

test('materiality thresholds are deterministic', () => {
  assert.equal(isMaterialVariance({ varianceAmount: MATERIAL_DOLLAR }), true)
  assert.equal(isMaterialVariance({ varianceAmount: MATERIAL_DOLLAR - 1 }), false)
})

// --- conservative mode stays clear of all NQ-2B detailed rules --------------

test('conservative mode carries none of the NQ-2B detailed phrasings', () => {
  const za = enriched({ account: '51500 Window Cleaning', actual: 0, budget: 19000, mode: 'conservative' })
  assert.doesNotMatch(za.text, /No service or expense was recorded|No activity posted against/)
  const mat = enriched({ account: '51600 Fire/Life Safety-Other', actual: 20000, budget: 5000, mode: 'conservative' })
  assert.doesNotMatch(mat.text, /material variance and should be reviewed/)
})
