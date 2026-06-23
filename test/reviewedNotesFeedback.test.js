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
  ZERO_ACTUAL_VARIANTS,
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

// The four phrases the reviewers flagged as overused boilerplate.
const BOILERPLATE = [
  /Activity exceeded the reported variance/,
  /Observed activity exceeded/,
  /may normalize over the period/,
  /may warrant future budgeting/
]

// --- 1/2. vendor / detail preference over generic offset language ----------

test('Janitorial Contract: vendor/service detail leads instead of offset boilerplate', () => {
  const note = enriched({
    account: '51200 Janitorial Contract', actual: 9000, budget: 5000,
    rows: [['Janitorial contract TRINITY BUILDING SERVICES', 12000]] // GL > variance → offset shape
  })
  assert.match(note.text, /Janitorial contract from Trinity Building Services appears in the account detail/)
  for (const re of BOILERPLATE) assert.doesNotMatch(note.text, re)
  assertSafe(note.text)
})

test('Security Contract: vendor/service detail leads instead of offset boilerplate', () => {
  const note = enriched({
    account: '51100 Security Contract', actual: 9000, budget: 3000,
    rows: [['Security monitoring ARMADA SECURITY', 15000]]
  })
  assert.match(note.text, /Security monitoring from Armada Security appears in the account detail/)
  for (const re of BOILERPLATE) assert.doesNotMatch(note.text, re)
  assertSafe(note.text)
})

test('HVAC Contract: boilerplate avoided when vendor/service detail is available', () => {
  const note = enriched({
    account: '51300 HVAC Contract', actual: 8000, budget: 5000,
    rows: [['HVAC maintenance BAY CITY MECHANICAL', 13000]]
  })
  // The flagged generic phrases must not appear; the service/vendor leads.
  for (const re of BOILERPLATE) assert.doesNotMatch(note.text, re)
  assert.match(note.text, /HVAC maintenance from Bay City Mechanical/)
  assertSafe(note.text)
})

// --- 3. zero-actual / 100%-under-budget lines ------------------------------

test('zero-actual expense line ends with one of the rotation variants', () => {
  // NQ-2B.1: the phrasing rotates across accurate equivalents, selected
  // deterministically from the account, so the sentence is one of the expense set.
  const note = enriched({ account: '51500 Window Cleaning', actual: 0, budget: 19000 })
  assert.ok(ZERO_ACTUAL_VARIANTS.expense.some((v) => note.text.endsWith(v)),
    `expected a zero-actual expense variant, got: ${note.text}`)
  assertSafe(note.text)
})

test('zero-actual revenue line ends with one of the rotation variants', () => {
  const note = enriched({
    account: '40100 Rental Income-Storage', actual: 0, budget: 200,
    accountType: 'revenue', category: 'unfavorable'
  })
  assert.ok(ZERO_ACTUAL_VARIANTS.other.some((v) => note.text.endsWith(v)),
    `expected a zero-actual revenue variant, got: ${note.text}`)
  assertSafe(note.text)
})

test('zero-actual phrasing rotates across a list (no robotic repetition)', () => {
  // NQ-2B.1: the original symptom was ~20 identical sentences down the expense
  // list. Across distinct accounts the deterministic rotation must produce more
  // than one phrasing, while every line stays an accurate, non-speculative fact.
  const accounts = [
    '51100 Alarm System Maint', '51200 HVAC-Repairs', '51300 Fire Sprinkler',
    '51400 Computer Supplies', '51500 Cleaning-Misc', '51600 Electrical Repairs',
    '51700 Pest Control', '51800 Landscaping'
  ]
  const sentences = accounts.map((account) => {
    const note = enriched({ account, actual: 0, budget: 1500 })
    const variant = ZERO_ACTUAL_VARIANTS.expense.find((v) => note.text.endsWith(v))
    assert.ok(variant, `expected a zero-actual expense variant, got: ${note.text}`)
    assertSafe(note.text)
    return variant
  })
  assert.ok(new Set(sentences).size > 1, 'rotation produced only one phrasing across the list')

  // Deterministic: the same account always reads the same way.
  const again = enriched({ account: '51100 Alarm System Maint', actual: 0, budget: 1500 })
  assert.ok(again.text.endsWith(sentences[0]), 'rotation is not deterministic for a fixed account')
})

test('zero-actual commentary does not speculate about why', () => {
  const note = enriched({ account: '51500 Window Cleaning', actual: 0, budget: 19000 })
  // No causal/explanatory speculation — just the fact that nothing posted.
  assert.doesNotMatch(note.text, /appears|suggest|recurring|offset|timing|budget adjustment/i)
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

test('negative actual is called out explicitly as a credit / reversal', () => {
  const note = enriched({
    account: '52000 Contra Expense', actual: -3000, budget: 1000, category: 'favorable'
  })
  assert.match(note.text, /This line reflects a net credit or reversal posted in the period\.$/)
  assertSafe(note.text)
})

test('a GL direction conflict is called out as credits or reversals', () => {
  // Reported variance is OVER budget, but the GL nets negative — opposite
  // directions, the classic credit/reversal signal.
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
  for (const v of [...ZERO_ACTUAL_VARIANTS.expense, ...ZERO_ACTUAL_VARIANTS.other]) {
    assert.ok(!za.text.includes(v), `conservative mode leaked a zero-actual variant: ${v}`)
  }
  const mat = enriched({ account: '51600 Fire/Life Safety-Other', actual: 20000, budget: 5000, mode: 'conservative' })
  assert.doesNotMatch(mat.text, /material variance and should be reviewed/)
})
