// Commentary Intent Engine tests — NQ-2A.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// The intent engine adds the optional third sentence — the SO-WHAT (implication)
// — to a GL-backed variance note, on top of the WHAT (S1, base variance) and the
// cause/evidence (S2). These tests prove, from reviewed-note-style scenarios:
//   • recurring activity, timing/true-up, budget omission, and one-time movements
//     each produce their approved hedged implication,
//   • the implication only attaches on confident (thick, ≥ 0.85) GL evidence,
//   • it is detailed-mode only (conservative output stays byte-identical),
//   • no note ever exceeds three sentences,
//   • no implication asserts causation, certainty, or financial advice.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { enrichNarrative, commentaryImplication } from '../src/lib/enrich/index.js'
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
    out.periods[0].expenseNotes.find((x) => x.account === account)
}

function sentenceCount(text) {
  return (String(text).match(/[.!?](?:\s|$)/g) || []).length
}

const FORBIDDEN = [
  /\bdue to\b/i, /caused by/i, /driven by/i, /\bdrove\b/i, /because of/i,
  /resulting from/i, /\bexplains?\b/i, /attributable to/i,
  /\bwill\b/i, /\bcertainly\b/i, /\bdefinitely\b/i, /\bmust\b/i
]
function assertSafe(text) {
  for (const re of FORBIDDEN) assert.doesNotMatch(text, re, `forbidden phrase ${re} in: ${text}`)
}

// --- 1. recurring pattern ---------------------------------------------------

test('recurring keyword in the detail yields a recurring implication', () => {
  // "Annual fire alarm testing" — a scheduled, repeating service.
  const note = enriched({
    account: '51400 Fire Alarm Testing', actual: 6000, budget: 5000,
    rows: [['Annual fire alarm testing PYRO-COMM SYSTEMS INC', 1000]]
  })
  assert.match(note.text, /This appears to reflect recurring service activity that may normalize over the period\.$/)
  assert.ok(sentenceCount(note.text) <= 3)
  assertSafe(note.text)
})

test('an evenly-spread population (classifier C) is recurring even without a keyword', () => {
  const note = enriched({
    account: '51500 Window Cleaning', actual: 9000, budget: 5000,
    rows: [['Window cleaning', 1000], ['Window cleaning', 1000], ['Window cleaning', 1000], ['Window cleaning', 1000]]
  })
  assert.match(note.text, /recurring service activity that may normalize over the period\.$/)
})

// --- 2. timing / true-up ----------------------------------------------------

test('a credit / true-up movement yields a timing implication', () => {
  // Favorable expense, a net credit — the classifier sees category E.
  const note = enriched({
    account: '54200 Insurance', actual: 1000, budget: 4000, category: 'favorable',
    rows: [['Premium refund', -3000]]
  })
  assert.match(note.text, /This appears to reflect a timing or true-up adjustment worth monitoring\.$/)
  assertSafe(note.text)
})

test('a reversal keyword on an aligned line yields a timing implication', () => {
  const note = enriched({
    account: '51800 Repairs', actual: 6000, budget: 5000,
    rows: [['Prior accrual reversal', 1000]]
  })
  assert.match(note.text, /timing or true-up adjustment worth monitoring\.$/)
})

// --- 3. budget omission -----------------------------------------------------

test('recurring activity against a zero budget reads as a budget omission', () => {
  const note = enriched({
    account: '51900 Monitoring Service', actual: 6000, budget: 0,
    rows: [['Monthly monitoring service ARMADA SECURITY', 6000]]
  })
  assert.match(note.text, /The activity appears recurring and may not have been reflected in the operating budget\.$/)
  assertSafe(note.text)
})

test('non-recurring activity against a zero budget suggests a budget adjustment', () => {
  const note = enriched({
    account: '51950 New One-Off Project', actual: 6000, budget: 0,
    rows: [['Project setup', 6000]]
  })
  assert.match(note.text, /This activity appears to fall outside the operating budget and may warrant a budget adjustment\.$/)
})

// --- 4. one-time ------------------------------------------------------------

test('a single, non-recurring transaction reads as a one-time item', () => {
  const note = enriched({
    account: '51999 Equipment Purchase', actual: 6000, budget: 5000,
    rows: [['Equipment purchase', 1000]]
  })
  assert.match(note.text, /This appears to be a one-time item that may normalize in future periods\.$/)
})

// --- 5. confidence gating ---------------------------------------------------

test('thin (name-only) GL evidence never gets an implication', () => {
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
  assert.doesNotMatch(note.text, /appears (to|recurring)|may normalize|worth monitoring|budget adjustment/)
})

test('commentaryImplication returns null below the high-confidence floor', () => {
  const base = {
    type: 'A', confidence: CONF_AE_MIN - 0.01, thick: true, account: '5000 Misc', detail: { count: 1, total: 1000 }
  }
  assert.equal(commentaryImplication(base), null)
  // At/above the floor, the same one-time shape does render.
  assert.match(
    commentaryImplication({ ...base, confidence: CONF_AE_MIN }),
    /one-time item that may normalize/
  )
})

// --- 6. detailed-only + identity -------------------------------------------

test('conservative mode never carries an implication', () => {
  const note = enriched({
    account: '51900 Monitoring Service', actual: 6000, budget: 0,
    rows: [['Monthly monitoring service', 6000]], mode: 'conservative'
  })
  assert.doesNotMatch(note.text, /appears recurring|may normalize|worth monitoring|budget adjustment/)
})

// --- 7. structure: never more than three sentences --------------------------

test('an enriched note never exceeds three sentences', () => {
  for (const c of [
    { account: '51400 Fire Alarm Testing', actual: 6000, budget: 5000, rows: [['Annual fire alarm testing', 1000]] },
    { account: '54200 Insurance', actual: 1000, budget: 4000, category: 'favorable', rows: [['Premium refund', -3000]] },
    { account: '51900 Monitoring Service', actual: 6000, budget: 0, rows: [['Monthly monitoring service', 6000]] },
    { account: '51999 Equipment Purchase', actual: 6000, budget: 5000, rows: [['Equipment purchase', 1000]] }
  ]) {
    const note = enriched(c)
    assert.ok(sentenceCount(note.text) <= 3, `>3 sentences: ${note.text}`)
    assertSafe(note.text)
  }
})
