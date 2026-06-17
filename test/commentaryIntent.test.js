// Commentary Intent Engine tests — NQ-2A.1.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// NQ-2A.1 replaces evidence NARRATION with an owner-facing EXPLANATION. The
// desired structure is exactly two sentences:
//   S1  variance observation              (base narrative — unchanged)
//   S2  explanation + implication         (the intent engine, detailed mode)
// There is no third sentence. These tests prove, from reviewed-note scenarios:
//   • recurring service, timing/true-up, budget omission, and revenue shortfall
//     each produce their approved hedged explanation,
//   • the explanation REPLACES the conservative evidence sentence (it is not just
//     appended), and conservative output keeps the old evidence wording,
//   • it only attaches on confident (thick, ≥ 0.85) GL evidence,
//   • it is detailed-mode only (conservative output stays byte-identical),
//   • a note never exceeds two sentences,
//   • no explanation asserts causation, certainty, or financial advice.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { enrichNarrative, explanationCommentary } from '../src/lib/enrich/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { CONF_AE_MIN } from '../src/lib/enrich/classify.js'

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

const GL_COLUMNS = ['Account', 'Date', 'Description', 'Amount']

// Build a one-account flagged narrative enriched with a small GL file, in the
// requested mode. `rows` are [description, amount] pairs for the account.
function enriched({ account, actual, budget, accountType, category, rows, mode = 'detailed' }) {
  const narrative = generateNarrative({
    fileId: 'base', fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report', thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{ period: 'current', comparisons: [rec({ account, actual, budget, accountType, category })] }]
  })
  const gl = {
    fileName: '4. General Ledger.pdf', status: 'ok', classification: { type: 'General Ledger (GL)' },
    normalized: { columns: GL_COLUMNS, rows: rows.map(([d, a]) => [account, '01/10/2026', d, String(a)]) }
  }
  const out = enrichNarrative(narrative, { supporting: [gl], mode })
  return out.periods[0].highVariances.find((x) => x.account === account) ||
    out.periods[0].revenueNotes.find((x) => x.account === account) ||
    out.periods[0].expenseNotes.find((x) => x.account === account)
}

// Count sentences (terminal punctuation followed by whitespace or end of string).
function sentenceCount(text) {
  return (String(text).match(/[.!?](?:\s|$)/g) || []).length
}

const FORBIDDEN = [
  /\bdue to\b/i, /caused by/i, /driven by/i, /\bdrove\b/i, /because of/i,
  /resulting from/i, /\bexplains\b/i, /attributable to/i,
  /\bwill\b/i, /\bcertainly\b/i, /\bdefinitely\b/i, /\bmust\b/i
]
function assertSafe(text) {
  for (const re of FORBIDDEN) assert.doesNotMatch(text, re, `forbidden phrase ${re} in: ${text}`)
}

// --- 1. recurring service ---------------------------------------------------

test('a recurring keyword in the detail yields a recurring explanation', () => {
  // "Annual fire alarm testing" — a scheduled, repeating service.
  const note = enriched({
    account: '51400 Fire Alarm Testing', actual: 6000, budget: 5000,
    rows: [['Annual fire alarm testing PYRO-COMM SYSTEMS INC', 1000]]
  })
  assert.match(note.text, /Annual fire alarm testing.*appears to explain the variance and may represent recurring activity\.$/)
  assert.ok(sentenceCount(note.text) <= 2)
  assertSafe(note.text)
})

test('an evenly-spread population (classifier C) is recurring even without a keyword', () => {
  const note = enriched({
    account: '51500 Window Cleaning', actual: 9000, budget: 5000,
    rows: [['Window cleaning', 1000], ['Window cleaning', 1000], ['Window cleaning', 1000], ['Window cleaning', 1000]]
  })
  assert.match(note.text, /appears to explain the variance and may represent recurring activity\.$/)
  assert.ok(sentenceCount(note.text) <= 2)
})

// --- 2. timing / true-up adjustment ----------------------------------------

test('a credit / true-up movement yields a timing explanation', () => {
  // Favorable expense, a net credit — the classifier sees category E.
  const note = enriched({
    account: '54200 Insurance', actual: 1000, budget: 4000, category: 'favorable',
    rows: [['Premium refund', -3000]]
  })
  assert.match(note.text, /appears to reflect a timing or true-up adjustment that may reverse in a later period\.$/)
  assert.ok(sentenceCount(note.text) <= 2)
  assertSafe(note.text)
})

test('a reversal keyword on an aligned line yields a timing explanation', () => {
  const note = enriched({
    account: '51800 Repairs', actual: 6000, budget: 5000,
    rows: [['Prior accrual reversal', 1000]]
  })
  assert.match(note.text, /timing or true-up adjustment that may reverse in a later period\.$/)
})

// --- 3. budget omission -----------------------------------------------------

test('recurring activity against a zero budget reads as a budget omission', () => {
  const note = enriched({
    account: '51900 Monitoring Service', actual: 6000, budget: 0,
    rows: [['Monthly monitoring service', 6000]]
  })
  assert.match(note.text, /appears to fall outside the planned budget and may represent recurring activity not yet budgeted\.$/)
  assert.ok(sentenceCount(note.text) <= 2)
  assertSafe(note.text)
})

test('non-recurring activity against a zero budget reads as recorded outside budget', () => {
  // NQ-2B rule 1: the overused "may warrant future budgeting" recommendation is
  // dropped in favor of a plain factual statement.
  const note = enriched({
    account: '51950 New One-Off Project', actual: 6000, budget: 0,
    rows: [['Project setup', 6000]]
  })
  assert.match(note.text, /was recorded outside the planned budget for the period\.$/)
  assert.doesNotMatch(note.text, /may warrant future budgeting/)
})

// --- 4. revenue shortfall ---------------------------------------------------

test('a revenue line below budget reads as a below-plan explanation', () => {
  // Commercial rent revenue came in under budget for the period.
  const note = enriched({
    account: '40100 Rental Income', actual: 8000, budget: 11000,
    accountType: 'revenue', category: 'unfavorable',
    rows: [['Rent - Commercial', 3000]]
  })
  // NQ-4A.1: medium-confidence evidence softens the assertion.
  assert.match(note.text, /Commercial rent activity appears to have been below plan for the period\.$/)
  assert.ok(sentenceCount(note.text) <= 2)
  assertSafe(note.text)
})

test('an expense line above budget reads as an above-plan explanation', () => {
  const note = enriched({
    account: '51999 Equipment Purchase', actual: 6000, budget: 5000,
    rows: [['Equipment purchase', 1000]]
  })
  // NQ-4A.1: medium-confidence evidence softens the assertion.
  assert.match(note.text, /Equipment purchase activity appears to have been above plan for the period\.$/)
})

// --- 5. explanation replacement (not appended) ------------------------------

test('the explanation REPLACES the conservative evidence sentence', () => {
  const args = {
    account: '51400 Fire Alarm Testing', actual: 6000, budget: 5000,
    rows: [['Annual fire alarm testing PYRO-COMM SYSTEMS INC', 1000]]
  }
  const detailed = enriched({ ...args, mode: 'detailed' })
  const conservative = enriched({ ...args, mode: 'conservative' })

  // Detailed no longer carries the old "reflects …" evidence narration.
  assert.doesNotMatch(detailed.text, /The (variance|movement) reflects/)
  assert.match(detailed.text, /appears to explain the variance and may represent recurring activity\.$/)
  // Conservative keeps the old evidence wording, and the two differ.
  assert.match(conservative.text, /The movement reflects/)
  assert.notEqual(detailed.text, conservative.text)
  // The detailed note is not the conservative note with a sentence appended.
  assert.ok(!detailed.text.startsWith(conservative.text))
})

// --- 6. maximum two sentences ----------------------------------------------

test('an enriched note never exceeds two sentences', () => {
  for (const c of [
    { account: '51400 Fire Alarm Testing', actual: 6000, budget: 5000, rows: [['Annual fire alarm testing', 1000]] },
    { account: '54200 Insurance', actual: 1000, budget: 4000, category: 'favorable', rows: [['Premium refund', -3000]] },
    { account: '51900 Monitoring Service', actual: 6000, budget: 0, rows: [['Monthly monitoring service', 6000]] },
    { account: '51999 Equipment Purchase', actual: 6000, budget: 5000, rows: [['Equipment purchase', 1000]] },
    { account: '40100 Rental Income', actual: 8000, budget: 11000, accountType: 'revenue', category: 'unfavorable', rows: [['Rent - Commercial', 3000]] }
  ]) {
    const note = enriched(c)
    assert.ok(sentenceCount(note.text) <= 2, `>2 sentences: ${note.text}`)
    assertSafe(note.text)
  }
})

// --- 7. confidence gating ---------------------------------------------------

test('thin (name-only) GL evidence never gets an explanation', () => {
  const narrative = generateNarrative({
    fileId: 'base', fileName: 'x.xlsx', baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{ period: 'current', comparisons: [rec({ account: 'Monitoring Service', actual: 6000, budget: 5000 })] }]
  })
  const thinGL = {
    fileName: 'gl.pdf', status: 'ok', classification: { type: 'General Ledger (GL)' },
    normalized: { columns: ['Account'], rows: [['Monitoring Service']] }
  }
  const note = enrichNarrative(narrative, { supporting: [thinGL], mode: 'detailed' })
    .periods[0].highVariances.find((x) => x.account === 'Monitoring Service')
  assert.doesNotMatch(note.text, /appears to (explain|reflect|fall)|was (above|below) plan|warrant future budgeting/)
})

test('explanationCommentary returns null below the high-confidence floor', () => {
  const base = {
    type: 'A', confidence: CONF_AE_MIN - 0.01, thick: true, account: '5000 Misc',
    detail: { count: 1, total: 1000 }, comparisonType: 'budget', varianceAmount: 1000
  }
  // No render-safe subject + below the floor → no explanation (falls back).
  assert.equal(explanationCommentary(base), null)
})

test('explanationCommentary returns null for thin or low-confidence (G) evidence', () => {
  assert.equal(explanationCommentary({ type: 'G', confidence: 0.9, thick: true }), null)
  assert.equal(explanationCommentary({ type: 'A', confidence: 0.9, thick: false }), null)
})

// --- 8. detailed-only + identity -------------------------------------------

test('conservative mode never carries an explanation', () => {
  const note = enriched({
    account: '51900 Monitoring Service', actual: 6000, budget: 0,
    rows: [['Monthly monitoring service', 6000]], mode: 'conservative'
  })
  assert.doesNotMatch(note.text, /appears to (explain|reflect|fall)|warrant future budgeting|was (above|below) plan/)
})
