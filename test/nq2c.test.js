// NQ-2C — Narrative Suppression + Account Semantics regression tests.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Covers three small, safe narrative rules layered on top of NQ-2B (detailed
// mode only for the commentary rules; conservative mode is byte-unchanged):
//   1. ZERO_NOISE suppression — sub-$1 "$0" / "$0.09" variances never render,
//      sections that empty out render safely, material lines are untouched.
//   2. Account semantics — prepaid/timing, depreciation/amortization, and
//      recovery accounts get cautious type wording, not operating-expense prose.
//   3. Generic fallback reduction — vendor/memo detail is preferred, tiny rows
//      get no boilerplate, every note stays ≤ 2 sentences with no certainty.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { enrichNarrative, accountSemanticType, ACCOUNT_SEMANTIC } from '../src/lib/enrich/index.js'
import {
  generateNarrative,
  isZeroNoiseVariance,
  ZERO_NOISE_DOLLAR
} from '../src/lib/narrative/index.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'

// --- helpers ---------------------------------------------------------------

// A comparison record as the variance engine emits it. `thresholdTriggered` is
// forced so a row reaches the narrative even when its dollar/percent would not
// otherwise flag it (the cases ZERO_NOISE must catch).
function comp({
  account,
  actual,
  budget,
  accountType = 'expense',
  category = 'unfavorable',
  thresholdTriggered = true,
  sourceRows = [0]
}) {
  const varianceAmount = Math.round((actual - budget) * 100) / 100
  const variancePercent = budget === 0 ? null : (varianceAmount / Math.abs(budget)) * 100
  return {
    account, actual, budget, prior: null, varianceAmount, variancePercent,
    comparisonType: 'budget', thresholdTriggered, category, accountType,
    missingData: false, confidence: 90, sourceRows
  }
}

function baseNarrative(comparisons) {
  return generateNarrative({
    fileId: 'base', fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report', thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{ period: 'current', comparisons }]
  })
}

const GL_COLUMNS = ['Account', 'Date', 'Reference', 'Vendor', 'Description', 'Amount']

// Enrich a one-account flagged narrative in the requested mode. With `rows` the
// GL matches the account (vendor/memo mined from the Description blob); without,
// a non-matching GL is supplied so the note is unmatched but the pass still runs.
function enriched({ account, actual, budget, accountType = 'expense', category = 'unfavorable', rows, mode = 'detailed' }) {
  const narrative = baseNarrative([comp({ account, actual, budget, accountType, category })])
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

function allNotes(period) {
  return [...period.highVariances, ...period.revenueNotes, ...period.expenseNotes]
}

function sentenceCount(text) {
  return (String(text).match(/[.!?](?:\s|$)/g) || []).length
}

const FORBIDDEN = [
  /\bdue to\b/i, /caused by/i, /driven by/i, /\bdrove\b/i, /because of/i,
  /resulting from/i, /attributable to/i, /\bwill\b/i, /\bcertainly\b/i,
  /\bdefinitely\b/i, /\bmust\b/i
]
function assertSafe(text) {
  assert.ok(sentenceCount(text) <= 2, `>2 sentences: ${text}`)
  for (const re of FORBIDDEN) assert.doesNotMatch(text, re, `forbidden phrase ${re} in: ${text}`)
}

// =========================================================================
// 1. ZERO_NOISE suppression
// =========================================================================

test('ZERO_NOISE: an exact $0 variance is suppressed from the narrative', () => {
  const n = baseNarrative([comp({ account: '51000 Cleaning Contract', actual: 5000, budget: 5000 })])
  const notes = allNotes(n.periods[0])
  assert.equal(notes.length, 0, 'a $0 variance must not render any note')
  // The base sentence that would have read "came in under budget by $0" is gone.
  assert.doesNotMatch(narrativeToMarkdown(n), /by \$0\b/)
})

test('ZERO_NOISE: a tiny decimal variance ($0.09) is suppressed', () => {
  const n = baseNarrative([comp({ account: '51010 Postage', actual: 82.09, budget: 82 })])
  assert.equal(allNotes(n.periods[0]).length, 0)
  assert.doesNotMatch(narrativeToMarkdown(n), /\$0\.09/)
})

test('ZERO_NOISE: helper and floor are deterministic ($1 is the boundary)', () => {
  assert.equal(ZERO_NOISE_DOLLAR, 1)
  assert.equal(isZeroNoiseVariance({ varianceAmount: 0 }), true)
  assert.equal(isZeroNoiseVariance({ varianceAmount: 0.09 }), true)
  assert.equal(isZeroNoiseVariance({ varianceAmount: -0.99 }), true)
  assert.equal(isZeroNoiseVariance({ varianceAmount: 1 }), false) // at/above $1 renders
  assert.equal(isZeroNoiseVariance({ varianceAmount: 25000 }), false)
  assert.equal(isZeroNoiseVariance({ varianceAmount: null }), false) // never suppress a non-number
})

test('ZERO_NOISE: a $1.00 variance still renders (only sub-$1 is suppressed)', () => {
  const n = baseNarrative([comp({ account: '51020 Supplies', actual: 5001, budget: 5000 })])
  assert.equal(allNotes(n.periods[0]).length, 1)
})

test('ZERO_NOISE: material lines survive while sub-$1 noise is dropped; emptied section is safe', () => {
  const n = baseNarrative([
    comp({ account: '51100 Major Repair', actual: 80000, budget: 5000 }), // $75,000 material
    comp({ account: '40100 Rental Income-Storage', actual: 200.03, budget: 200, accountType: 'revenue', category: 'favorable' }) // $0.03 noise
  ])
  const md = narrativeToMarkdown(n)
  assert.match(md, /Major Repair exceeded budget by \$75,000/)
  // The revenue noise line is gone, and the now-empty Revenue Notes section
  // renders its safe placeholder rather than throwing or leaving a dangling head.
  assert.doesNotMatch(md, /Rental Income-Storage/)
  assert.match(md, /### Revenue Notes\n\n_None\._/)
})

test('ZERO_NOISE: the executive summary counts only the surviving variances', () => {
  const n = baseNarrative([
    comp({ account: '51100 Major Repair', actual: 80000, budget: 5000 }),
    comp({ account: '51200 Rounding', actual: 5000.4, budget: 5000 }) // $0.40 noise
  ])
  // Two rows triggered, one is noise → the summary headline counts a single variance.
  assert.match(n.periods[0].executiveSummary[0].text, /1 variance totaling/)
})

// =========================================================================
// 2. Account semantics
// =========================================================================

test('account-type detection is deterministic across the three families', () => {
  assert.equal(accountSemanticType('Current Month Prepaid Rent'), 'TIMING')
  assert.equal(accountSemanticType('Prepaid Rent'), 'TIMING')
  assert.equal(accountSemanticType('A/R Tenant'), 'TIMING')
  assert.equal(accountSemanticType('Accrued Property Tax'), 'TIMING')
  assert.equal(accountSemanticType('Deferred Rent'), 'TIMING')
  assert.equal(accountSemanticType('Rent Clearing'), 'TIMING')
  assert.equal(accountSemanticType('Depreciation Expense'), 'NON_CASH')
  assert.equal(accountSemanticType('Amortization-Tenant Improvements'), 'NON_CASH')
  assert.equal(accountSemanticType('CAM Recovery'), 'RECOVERY')
  assert.equal(accountSemanticType('Utility Expense Recovery'), 'RECOVERY')
  // Plain operating accounts get no semantic family.
  assert.equal(accountSemanticType('51200 Janitorial Contract'), null)
  assert.equal(accountSemanticType('54200 Insurance'), null)
})

test('prepaid / timing account: timing-or-balance wording, not operating prose', () => {
  const note = enriched({ account: 'Current Month Prepaid Rent', actual: 60000, budget: 5000 })
  assert.match(note.text, /This appears to be a timing or balance-sheet related variance/)
  assert.match(note.text, /timing\/classification item rather than operating performance/)
  // No operating-performance / exceeded-budget commentary leaked into S2.
  assert.doesNotMatch(note.text, /exceeded the reported variance|recurring activity/)
  assertSafe(note.text)
})

test('depreciation: non-cash wording referencing the schedule', () => {
  const note = enriched({ account: '60000 Depreciation Expense', actual: 40000, budget: 5000 })
  assert.match(note.text, /This is a non-cash expense variance/)
  assert.match(note.text, /depreciation\/amortization schedule/)
  assertSafe(note.text)
})

test('amortization: same non-cash wording', () => {
  const note = enriched({ account: '60100 Amortization-Loan Costs', actual: 30000, budget: 5000 })
  assert.match(note.text, /non-cash expense variance/)
  assertSafe(note.text)
})

test('recovery line → MAPPING_PASSTHROUGH diagnosis wording (NQ-5B)', () => {
  const note = enriched({
    account: '5100 Utility Expense Recovery', actual: 12700, budget: 5334,
    rows: [['Tenant utility recovery', 7400]]
  })
  // NQ-5B: a recovery line carries no subject, so the diagnosis owner sentence
  // supersedes the NQ-2C recovery-semantics wording.
  assert.match(note.text, /Recoveries or billbacks may lag expense recognition and should be reviewed against tenant recovery billing\.$/)
  assertSafe(note.text)
})

test('account semantics fire with no supporting GL match (name-based)', () => {
  const note = enriched({ account: 'Deferred Rent', actual: 50000, budget: 5000 }) // no rows → unmatched
  assert.match(note.text, /timing or balance-sheet related variance/)
  assertSafe(note.text)
})

test('an immaterial recovery line gets no semantic commentary (suppression wins)', () => {
  // $22 / 37% — operationally immaterial → S1 only, no S2 semantic sentence.
  const note = enriched({
    account: 'CAM Recovery', actual: 60, budget: 82, category: 'favorable',
    rows: [['Recovery', 22]]
  })
  assert.equal(sentenceCount(note.text), 1, `expected S1 only, got: ${note.text}`)
  assert.doesNotMatch(note.text, /Recovery variance appears tied/)
})

test('conservative mode carries NONE of the NQ-2C account-semantic wording', () => {
  const prepaid = enriched({ account: 'Prepaid Rent', actual: 60000, budget: 5000, mode: 'conservative' })
  assert.doesNotMatch(prepaid.text, /timing or balance-sheet related variance/)
  const dep = enriched({ account: 'Depreciation Expense', actual: 40000, budget: 5000, mode: 'conservative' })
  assert.doesNotMatch(dep.text, /non-cash expense variance/)
  const rec = enriched({
    account: 'Utility Expense Recovery', actual: 12700, budget: 5334, mode: 'conservative',
    rows: [['Tenant utility recovery', 7400]]
  })
  assert.doesNotMatch(rec.text, /Recovery variance appears tied/)
})

test('the semantic wording table itself carries no causal / certainty language', () => {
  for (const sentence of Object.values(ACCOUNT_SEMANTIC)) {
    assert.equal(sentenceCount(sentence), 1, `each family is one sentence: ${sentence}`)
    assertSafe(sentence)
  }
})

// =========================================================================
// 3. Generic fallback reduction
// =========================================================================

test('offset line with safe vendor detail is preserved under NQ-5B', () => {
  const note = enriched({
    account: '51200 Janitorial Contract', actual: 9000, budget: 5000,
    rows: [['Janitorial contract TRINITY BUILDING SERVICES', 12000]]
  })
  // NQ-5B (refined): strong vendor evidence is preserved, not replaced by owner copy.
  assert.match(note.text, /Janitorial contract from Trinity Building Services appears in the account detail/)
  assert.doesNotMatch(note.text, /Related account activity appears broader/)
  assertSafe(note.text)
})

test('a no-detail material line uses a shorter fallback (no speculative tail)', () => {
  // Offset-heavy shape with no render-safe vendor/memo → the shortened fallback.
  const note = enriched({
    account: '51900 Repairs Expense', actual: 45000, budget: 5000,
    rows: [['xx', 9999999]] // huge unnamed total → exceeds-variance / offset shape
  })
  assert.doesNotMatch(note.text, /suggesting offsetting entries or timing effects influenced the result/)
  assert.doesNotMatch(note.text, /Observed activity exceeded/)
  assertSafe(note.text)
})

test('a tiny-dollar variance gets no boilerplate fallback (S1 only)', () => {
  const note = enriched({
    account: '53000 Postage', actual: 60, budget: 82, category: 'favorable',
    rows: [['Postage', 22]]
  })
  assert.equal(sentenceCount(note.text), 1, `expected S1 only, got: ${note.text}`)
})

test('every enriched note across the families stays within two sentences', () => {
  const samples = [
    enriched({ account: 'Prepaid Insurance', actual: 60000, budget: 5000 }),
    enriched({ account: 'Depreciation Expense', actual: 40000, budget: 5000 }),
    enriched({ account: 'Tax Recovery', actual: 30000, budget: 5000, rows: [['Tax recovery', 25000]] }),
    enriched({ account: '51200 Janitorial Contract', actual: 9000, budget: 5000, rows: [['Janitorial contract TRINITY BUILDING SERVICES', 12000]] })
  ]
  for (const note of samples) assertSafe(note.text)
})
