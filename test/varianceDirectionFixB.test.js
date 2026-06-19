// Fix B — Deterministic variance direction + reportStyle → commentaryMode wiring.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Two confirmed bugs are locked down here:
//   (1) DIRECTION: favorable/unfavorable/neutral is arithmetic — variance sign +
//       account type — and must be deterministic (never an LLM judgment, never
//       flipping between runs). Includes the live "Admin Fee … under budget"
//       regression, which was mistyped revenue (so under-budget read unfavorable).
//   (2) WIRING: the deterministic narrative now honors the active Style panel's
//       reportStyle (Concise → conservative, Detailed → detailed), instead of the
//       orphaned commentaryDetail field that hardcoded 'detailed'.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { accountType, classify, calculateRow } from '../src/lib/variance/calculate.js'
import { commentaryModeFromStyle } from '../src/lib/enrich/commentaryMode.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { buildSystemPrompt } from '../server/llm.js'

// --- 1. Direction truth table (classify) -----------------------------------

test('classify: expense direction is arithmetic (under budget favorable, over unfavorable)', () => {
  // varianceAmount = actual − budget. Expense: spending less is good.
  assert.equal(classify('expense', -500), 'favorable') // actual < budget → under budget
  assert.equal(classify('expense', 500), 'unfavorable') // actual > budget → over budget
})

test('classify: revenue direction is arithmetic (above budget favorable, below unfavorable)', () => {
  assert.equal(classify('revenue', 500), 'favorable') // actual > budget → more revenue
  assert.equal(classify('revenue', -500), 'unfavorable') // actual < budget → less revenue
})

test('classify: zero / unknown / non-finite variance is neutral', () => {
  assert.equal(classify('expense', 0), 'neutral')
  assert.equal(classify('revenue', 0), 'neutral')
  assert.equal(classify('unknown', 500), 'neutral')
  assert.equal(classify('expense', null), 'neutral')
  assert.equal(classify('expense', NaN), 'neutral')
})

// --- 2. Account typing (so direction is applied to the right rule) ----------

test('accountType: owner-paid fee lines are expenses, not revenue', () => {
  assert.equal(accountType('Admin Fee - CY'), 'expense')
  assert.equal(accountType('Administrative Fee'), 'expense')
  assert.equal(accountType('Management Fees'), 'expense')
  assert.equal(accountType('Legal Fees'), 'expense')
  assert.equal(accountType('Professional Fees'), 'expense')
})

test('accountType: explicit fee income stays revenue', () => {
  assert.equal(accountType('Fee Income'), 'revenue')
  assert.equal(accountType('Application Fee Revenue'), 'revenue')
  assert.equal(accountType('Rental Income'), 'revenue')
})

test('accountType: the "sales tax" / "cost of sales" expense guard is preserved', () => {
  assert.equal(accountType('Sales Tax'), 'expense')
  assert.equal(accountType('Cost of Sales'), 'expense')
  assert.equal(accountType('Rental Sales'), 'revenue')
})

// --- 3. End-to-end direction through calculateRow ---------------------------

function rowCategory({ account, actual, budget }) {
  return calculateRow({ account, actual, budget, prior: null, sourceRows: [0] }).category
}

test('direction truth table through calculateRow', () => {
  // expense
  assert.equal(rowCategory({ account: 'Repairs Expense', actual: 800, budget: 1000 }), 'favorable')
  assert.equal(rowCategory({ account: 'Repairs Expense', actual: 1200, budget: 1000 }), 'unfavorable')
  // revenue
  assert.equal(rowCategory({ account: 'Rental Income', actual: 1200, budget: 1000 }), 'favorable')
  assert.equal(rowCategory({ account: 'Rental Income', actual: 800, budget: 1000 }), 'unfavorable')
  // zero / within-threshold (equal) → neutral
  assert.equal(rowCategory({ account: 'Repairs Expense', actual: 1000, budget: 1000 }), 'neutral')
})

// --- 4. Live regression: "Admin Fee - CY came in under budget" --------------

test('REGRESSION: an under-budget Admin Fee reads FAVORABLE (was unfavorable)', () => {
  const row = calculateRow({ account: 'Admin Fee - CY', actual: 4000, budget: 6000, prior: null, sourceRows: [0] })
  assert.equal(row.accountType, 'expense')
  assert.equal(row.varianceAmount < 0, true) // came in under budget
  assert.equal(row.category, 'favorable')
})

test('REGRESSION: an over-budget Admin Fee reads UNFAVORABLE', () => {
  const row = calculateRow({ account: 'Admin Fee - CY', actual: 8000, budget: 6000, prior: null, sourceRows: [0] })
  assert.equal(row.accountType, 'expense')
  assert.equal(row.category, 'unfavorable')
})

test('direction is deterministic — identical across repeated runs (no flipping)', () => {
  const input = { account: 'Admin Fee - CY', actual: 4000, budget: 6000, prior: null, sourceRows: [0] }
  const first = calculateRow(input).category
  for (let i = 0; i < 25; i++) {
    assert.equal(calculateRow(input).category, first)
  }
  assert.equal(first, 'favorable')
})

// --- 5. Wiring: reportStyle → commentaryMode (not hardcoded) ----------------

test('commentaryModeFromStyle reads the live reportStyle field', () => {
  assert.equal(commentaryModeFromStyle({ reportStyle: 'Detailed' }), 'detailed')
  assert.equal(commentaryModeFromStyle({ reportStyle: 'Concise' }), 'conservative')
  // Concise and Detailed must NOT resolve to the same mode (no hardcoding).
  assert.notEqual(
    commentaryModeFromStyle({ reportStyle: 'Concise' }),
    commentaryModeFromStyle({ reportStyle: 'Detailed' })
  )
})

test('commentaryModeFromStyle ignores the orphaned commentaryDetail field', () => {
  // The removed control must no longer steer the mode.
  assert.equal(commentaryModeFromStyle({ commentaryDetail: 'Conservative' }), 'detailed')
})

// --- 6. Wiring produces different deterministic narrative output -------------

const GL_COLUMNS = ['Account', 'Date', 'Reference', 'Vendor', 'Description', 'Amount']

function narrativeTextForStyle(reportStyle) {
  const account = 'Repairs Expense'
  const narrative = generateNarrative({
    fileId: 'base', fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report', thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{
      period: 'current',
      comparisons: [{
        account, actual: 18000, budget: 10000, prior: null,
        varianceAmount: 8000, variancePercent: 80, comparisonType: 'budget',
        thresholdTriggered: true, category: 'unfavorable', accountType: 'expense',
        missingData: false, confidence: 90, sourceRows: [0]
      }]
    }]
  })
  const gl = {
    fileName: '4. General Ledger.pdf', status: 'ok', classification: { type: 'General Ledger (GL)' },
    normalized: {
      columns: GL_COLUMNS,
      rows: [[account, '01/10/2026', 'INV-1', 'Acme Roofing', 'Roof repair', '8000']]
    }
  }
  const mode = commentaryModeFromStyle({ reportStyle })
  const out = enrichNarrative(narrative, { supporting: [gl], mode })
  const note = out.periods[0].expenseNotes.find((x) => x.account === account) ||
    out.periods[0].highVariances.find((x) => x.account === account)
  return note.text
}

test('Concise vs Detailed report styles yield different deterministic commentary', () => {
  const concise = narrativeTextForStyle('Concise')
  const detailed = narrativeTextForStyle('Detailed')
  assert.notEqual(concise, detailed)
})

// --- 7. The LLM is barred from determining direction ------------------------

test('the LLM system prompt forbids favorable/unfavorable judgments', () => {
  const prompt = buildSystemPrompt({ reportStyle: 'Detailed' })
  assert.match(prompt, /favorable or unfavorable/i)
  assert.match(prompt, /that judgment is made elsewhere/i)
})
