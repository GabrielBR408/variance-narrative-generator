// Variance engine tests — Phase 7.1 / 8.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
// Exercises the deterministic variance pipeline only: column detection, the
// Current/YTD period split, and the math against the real-PDF QA targets.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeVariance, detectComparisonSets } from '../src/lib/variance/index.js'

// Header layout of the real statement: Account + Current{Actual,Budget,Var,Var%}
// + YTD{Actual,Budget,Var,Var%}.
const COLUMNS = [
  'Account',
  'Current Actual',
  'Current Budget',
  'Current Variance',
  'Current Variance %',
  'YTD Actual',
  'YTD Budget',
  'YTD Variance',
  'YTD Variance %'
]

// Actual/Budget chosen to reproduce the QA variance targets exactly; the
// variance columns are present (as the PDF has them) but ignored — the engine
// recomputes from Actual − Budget.
const ROWS = [
  [
    'Rental Inc. - Commercial',
    '29517.42', '37392.22', '-7874.80', '-21.06%',
    '358495.18', '374173.03', '-15677.85', '-4.19%'
  ],
  [
    'Utility-Elect-Building',
    '614.87', '530.06', '84.81', '16.00%',
    '5896.96', '5420.00', '476.96', '8.80%'
  ]
]

function extraction(overrides = {}) {
  return {
    fileId: 'f1',
    fileName: 'statement.pdf',
    status: 'ok',
    confidence: 75,
    classification: { type: 'variance-report' },
    normalized: { columns: COLUMNS, rows: ROWS, accounts: [], dates: [], values: [] },
    ...overrides
  }
}

const near = (a, b, eps = 0.05) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b} (±${eps})`)

test('detectComparisonSets splits Current and YTD with a shared account column', () => {
  const { account, sets } = detectComparisonSets(COLUMNS, ROWS)
  assert.equal(account, 0)
  assert.deepEqual(sets.map((s) => s.period), ['current', 'ytd'])
  assert.deepEqual(sets[0].columns, { actual: 1, budget: 2, prior: null })
  assert.deepEqual(sets[1].columns, { actual: 5, budget: 6, prior: null })
})

// A comparative statement whose merged "Year-To-Date" band did not repeat the
// Actual/Budget sub-labels: after header folding the YTD columns carry only the
// period label, with no value-type keyword. The YTD value columns must still be
// recovered positionally from the fully-labeled Current period, or the entire
// YTD set is dropped (Current reads, YTD comes back null).
const UNLABELED_YTD_COLUMNS = [
  'Account',
  'Current Period Actual',
  'Current Period Budget',
  'Current Period Variance',
  'Current Period Variance %',
  'Year-To-Date',
  'Year-To-Date',
  'Year-To-Date',
  'Year-To-Date'
]

test('detectComparisonSets recovers a YTD band whose value sub-labels were not repeated', () => {
  const { account, sets } = detectComparisonSets(UNLABELED_YTD_COLUMNS, ROWS)
  assert.equal(account, 0)
  assert.deepEqual(sets.map((s) => s.period), ['current', 'ytd'])
  assert.deepEqual(sets[0].columns, { actual: 1, budget: 2, prior: null })
  // Mirrors the Current period's offsets: YTD Actual at col F (5), Budget at G (6).
  assert.deepEqual(sets[1].columns, { actual: 5, budget: 6, prior: null })
})

test('computeVariance produces real YTD numbers from an unlabeled YTD band', () => {
  const result = computeVariance(extraction({
    normalized: { columns: UNLABELED_YTD_COLUMNS, rows: ROWS, accounts: [], dates: [], values: [] }
  }))
  const ytd = result.comparisonSets.find((s) => s.period === 'ytd')
  assert.ok(ytd, 'YTD comparison set must exist')
  const rental = ytd.comparisons.find((c) => c.account.startsWith('Rental'))
  assert.equal(rental.actual, 358495.18)
  assert.equal(rental.budget, 374173.03)
  near(rental.varianceAmount, -15677.85)
  near(rental.variancePercent, -4.19)
})

test('computeVariance exposes both periods in comparisonSets', () => {
  const result = computeVariance(extraction())
  assert.ok(Array.isArray(result.comparisonSets))
  assert.deepEqual(result.comparisonSets.map((s) => s.period), ['current', 'ytd'])
})

test('top-level comparisons/summary mirror the Current period (backward compatible)', () => {
  const result = computeVariance(extraction())
  const current = result.comparisonSets.find((s) => s.period === 'current')
  assert.deepEqual(result.comparisons, current.comparisons)
  assert.deepEqual(result.summary, current.summary)
  assert.equal(result.confidence, current.confidence)
})

test('Current period reproduces the QA variance targets', () => {
  const { comparisons } = computeVariance(extraction()).comparisonSets.find(
    (s) => s.period === 'current'
  )
  const rental = comparisons.find((c) => c.account.startsWith('Rental'))
  const utility = comparisons.find((c) => c.account.startsWith('Utility'))

  near(rental.varianceAmount, -7874.8)
  near(rental.variancePercent, -21.06)
  near(utility.varianceAmount, 84.81)
  near(utility.variancePercent, 16.0)
})

test('YTD period reproduces the QA variance targets', () => {
  const { comparisons } = computeVariance(extraction()).comparisonSets.find(
    (s) => s.period === 'ytd'
  )
  const rental = comparisons.find((c) => c.account.startsWith('Rental'))
  const utility = comparisons.find((c) => c.account.startsWith('Utility'))

  near(rental.varianceAmount, -15677.85)
  near(rental.variancePercent, -4.19)
  near(utility.varianceAmount, 476.96)
  near(utility.variancePercent, 8.8)
})

test('a single-period (no-YTD) table yields one set and stays backward compatible', () => {
  const ex = extraction({
    normalized: {
      columns: ['Account', 'Actual', 'Budget'],
      rows: [['Rent', '1200', '1000']],
      accounts: [],
      dates: [],
      values: []
    }
  })
  const result = computeVariance(ex)
  assert.equal(result.comparisonSets.length, 1)
  assert.equal(result.comparisonSets[0].period, 'current')
  assert.equal(result.comparisons.length, 1)
  near(result.comparisons[0].varianceAmount, 200)
})

test('non-tabular extraction reports honestly, no comparisonSets', () => {
  const ex = extraction({ normalized: { columns: [], rows: [['just text']], accounts: [], dates: [], values: [] } })
  const result = computeVariance(ex)
  assert.equal(result.reason, 'not-tabular')
  assert.equal(result.comparisons.length, 0)
  assert.equal(result.comparisonSets, undefined)
})
