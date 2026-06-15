// Narrative engine tests — Phase 9A.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
// Covers the deterministic narrative layer: favorable/unfavorable wording,
// threshold gating, source traceability, Current/YTD rendering, empty results,
// and the variance → narrative integration over a real result shape.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeVariance } from '../src/lib/variance/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'

// --- helpers ---------------------------------------------------------------

// Build a single comparison record matching calculate.js output, computing the
// variance fields the way the engine does so the test data is self-consistent.
function rec({ account, actual, budget = null, prior = null, accountType, category, sourceRows }) {
  const comparison = budget !== null ? budget : prior
  const comparisonType = budget !== null ? 'budget' : prior !== null ? 'prior' : null
  const hasActual = typeof actual === 'number'
  const hasComparison = typeof comparison === 'number'
  const varianceAmount = hasActual && hasComparison ? actual - comparison : null
  const variancePercent =
    varianceAmount === null || comparison === 0 ? null : (varianceAmount / Math.abs(comparison)) * 100
  const thresholdTriggered =
    varianceAmount !== null &&
    (Math.abs(varianceAmount) >= 1000 || (variancePercent !== null && Math.abs(variancePercent) >= 10))
  return {
    account,
    actual: hasActual ? actual : null,
    budget,
    prior,
    varianceAmount,
    variancePercent,
    comparisonType,
    thresholdTriggered,
    category,
    accountType,
    missingData: !hasActual || !hasComparison,
    confidence: 90,
    sourceRows: sourceRows || []
  }
}

function result(comparisonSets) {
  return {
    fileId: 'f1',
    fileName: 'statement.pdf',
    baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets
  }
}

// --- favorable / unfavorable ----------------------------------------------

test('favorable revenue reads as exceeding budget and keeps the category', () => {
  const r = result([
    { period: 'current', comparisons: [
      rec({ account: 'Revenue', actual: 12000, budget: 10000, accountType: 'revenue', category: 'favorable', sourceRows: [3] })
    ] }
  ])
  const { periods } = generateNarrative(r)
  const note = periods[0].highVariances[0]
  assert.match(note.text, /Revenue exceeded budget by \$2,000/)
  assert.match(note.text, /\(20\.0%\)/)
  assert.equal(note.category, 'favorable')
  assert.deepEqual(periods[0].revenueNotes.map((n) => n.text), [note.text])
})

test('unfavorable expense reads as exceeding budget and surfaces in expense notes', () => {
  const r = result([
    { period: 'ytd', comparisons: [
      rec({ account: 'Operating expense', actual: 15000, budget: 10000, accountType: 'expense', category: 'unfavorable', sourceRows: [5] })
    ] }
  ])
  const { periods } = generateNarrative(r)
  const note = periods[0].expenseNotes[0]
  assert.match(note.text, /Operating expense exceeded budget by \$5,000 \(50\.0%\) year-to-date\./)
  assert.equal(note.category, 'unfavorable')
})

test('favorable expense reads as coming in under budget', () => {
  const r = result([
    { period: 'current', comparisons: [
      rec({ account: 'Payroll expense', actual: 8000, budget: 10000, accountType: 'expense', category: 'favorable', sourceRows: [2] })
    ] }
  ])
  const note = generateNarrative(r).periods[0].expenseNotes[0]
  assert.match(note.text, /came in under budget by \$2,000/)
})

// --- threshold behavior ----------------------------------------------------

test('rows below threshold are never narrated', () => {
  const r = result([
    { period: 'current', comparisons: [
      // $500 / 5% — below both thresholds
      rec({ account: 'Small Line', actual: 10500, budget: 10000, accountType: 'revenue', category: 'favorable', sourceRows: [1] }),
      // $5000 / 50% — triggers
      rec({ account: 'Big Line', actual: 15000, budget: 10000, accountType: 'revenue', category: 'favorable', sourceRows: [2] })
    ] }
  ])
  const p = generateNarrative(r).periods[0]
  assert.equal(p.highVariances.length, 1)
  assert.match(p.highVariances[0].text, /Big Line/)
})

test('high variances are ordered by materiality, largest first', () => {
  const r = result([
    { period: 'current', comparisons: [
      rec({ account: 'Mid', actual: 13000, budget: 10000, accountType: 'expense', category: 'unfavorable', sourceRows: [1] }),
      rec({ account: 'Largest', actual: 20000, budget: 10000, accountType: 'expense', category: 'unfavorable', sourceRows: [2] }),
      rec({ account: 'Small', actual: 11500, budget: 10000, accountType: 'expense', category: 'unfavorable', sourceRows: [3] })
    ] }
  ])
  const order = generateNarrative(r).periods[0].highVariances.map((n) => n.account)
  assert.deepEqual(order, ['Largest', 'Mid', 'Small'])
})

// --- source traceability ---------------------------------------------------

test('every sentence carries its source rows and the period aggregates them', () => {
  const r = result([
    { period: 'current', comparisons: [
      rec({ account: 'Revenue', actual: 12000, budget: 10000, accountType: 'revenue', category: 'favorable', sourceRows: [4] }),
      rec({ account: 'Rent', actual: 9000, budget: 6000, accountType: 'expense', category: 'unfavorable', sourceRows: [7] }),
      rec({ account: 'Orphan', actual: 5000, budget: null, accountType: 'unknown', category: 'neutral', sourceRows: [9] })
    ] }
  ])
  const p = generateNarrative(r).periods[0]
  for (const note of p.highVariances) assert.ok(note.sourceRows.length > 0)
  assert.deepEqual(p.missingData[0].sourceRows, [9])
  // Executive + high + missing rows all roll up into the period source set.
  assert.deepEqual(p.sourceRows, [4, 7, 9])
  assert.ok(p.executiveSummary[0].sourceRows.includes(4))
})

// --- current / ytd rendering ----------------------------------------------

test('current and YTD produce separately-labeled periods with their own wording', () => {
  const r = result([
    { period: 'current', comparisons: [
      rec({ account: 'Revenue', actual: 12000, budget: 10000, accountType: 'revenue', category: 'favorable', sourceRows: [1] })
    ] },
    { period: 'ytd', comparisons: [
      rec({ account: 'Revenue', actual: 130000, budget: 100000, accountType: 'revenue', category: 'favorable', sourceRows: [1] })
    ] }
  ])
  const { periods } = generateNarrative(r)
  assert.deepEqual(periods.map((p) => p.period), ['current', 'ytd'])
  assert.equal(periods[0].periodLabel, 'Current')
  assert.equal(periods[1].periodLabel, 'YTD')
  assert.match(periods[0].highVariances[0].text, /for the current period\.$/)
  assert.match(periods[1].highVariances[0].text, /year-to-date\.$/)
})

// --- missing data ----------------------------------------------------------

test('missing data is reported, never assumed, with no invented figures', () => {
  const r = result([
    { period: 'current', comparisons: [
      rec({ account: 'No Budget', actual: 5000, budget: null, accountType: 'revenue', category: 'neutral', sourceRows: [3] })
    ] }
  ])
  const p = generateNarrative(r).periods[0]
  assert.equal(p.missingData.length, 1)
  assert.match(p.missingData[0].text, /budget or prior comparison unavailable/i)
  // No dollar figure should appear in a missing-data line.
  assert.doesNotMatch(p.missingData[0].text, /\$/)
})

// --- empty results ---------------------------------------------------------

test('a period with no triggered rows yields empty sections and a calm summary', () => {
  const r = result([
    { period: 'current', comparisons: [
      rec({ account: 'Quiet', actual: 10100, budget: 10000, accountType: 'revenue', category: 'favorable', sourceRows: [1] })
    ] }
  ])
  const p = generateNarrative(r).periods[0]
  assert.equal(p.highVariances.length, 0)
  assert.equal(p.revenueNotes.length, 0)
  assert.equal(p.expenseNotes.length, 0)
  assert.match(p.executiveSummary[0].text, /no variances crossed/i)
  assert.deepEqual(p.executiveSummary[0].sourceRows, [])
})

test('an empty variance result produces a narrative with no periods', () => {
  const n = generateNarrative({ fileId: 'x', fileName: 'empty.pdf', comparisonSets: [] })
  assert.deepEqual(n.periods, [])
})

// --- integration: variance → narrative ------------------------------------

const COLUMNS = [
  'Account',
  'Current Actual', 'Current Budget', 'Current Variance', 'Current Variance %',
  'YTD Actual', 'YTD Budget', 'YTD Variance', 'YTD Variance %'
]
const ROWS = [
  ['Rental Inc. - Commercial', '29517.42', '37392.22', '-7874.80', '-21.06%',
   '358495.18', '374173.03', '-15677.85', '-4.19%'],
  ['Utility-Elect-Building', '614.87', '530.06', '84.81', '16.00%',
   '5896.96', '5420.00', '476.96', '8.80%']
]

test('variance → narrative renders triggered rows from a real extraction shape', () => {
  const extraction = {
    fileId: 'f1', fileName: 'statement.pdf', status: 'ok', confidence: 75,
    classification: { type: 'variance-report' },
    normalized: { columns: COLUMNS, rows: ROWS, accounts: [], dates: [], values: [] }
  }
  const variance = computeVariance(extraction)
  const narrative = generateNarrative(variance)

  assert.equal(narrative.fileName, 'statement.pdf')
  assert.deepEqual(narrative.periods.map((p) => p.period), ['current', 'ytd'])

  const current = narrative.periods[0]
  // Rental income is below budget by $7,874.80 (revenue → unfavorable) and crosses
  // the dollar threshold, so it must appear and reference its source row (0).
  const rental = current.highVariances.find((n) => /Rental Inc/.test(n.account))
  assert.ok(rental, 'rental income variance should be narrated')
  assert.match(rental.text, /\$7,874\.8\b/)
  assert.deepEqual(rental.sourceRows, [0])

  // Every high-variance sentence is traceable and threshold-triggered only.
  for (const n of current.highVariances) assert.ok(n.sourceRows.length > 0)
})
