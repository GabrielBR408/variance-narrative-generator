// Narrative engine tests — Phase 9A.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
// Covers the deterministic narrative layer: favorable/unfavorable wording,
// threshold gating, source traceability, Current/YTD rendering, empty results,
// and the variance → narrative integration over a real result shape.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeVariance } from '../src/lib/variance/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'
import { HIGH_VARIANCE_HEADLINE_LIMIT } from '../src/lib/narrative/sections.js'

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

// NQ-1B: the top material drivers lead High Variances and are not relisted in
// the category notes, so these category-note tests use three larger drivers to
// push the asserted line out of the headline and into its Revenue/Expense Note.
const HEADLINE_FILLERS = [
  rec({ account: 'Driver A', actual: 70000, budget: 10000, accountType: 'expense', category: 'unfavorable', sourceRows: [20] }),
  rec({ account: 'Driver B', actual: 65000, budget: 10000, accountType: 'expense', category: 'unfavorable', sourceRows: [21] }),
  rec({ account: 'Driver C', actual: 60000, budget: 10000, accountType: 'expense', category: 'unfavorable', sourceRows: [22] })
]

test('favorable revenue reads as exceeding budget and keeps the category', () => {
  const r = result([
    { period: 'current', comparisons: [
      ...HEADLINE_FILLERS,
      rec({ account: 'Revenue', actual: 12000, budget: 10000, accountType: 'revenue', category: 'favorable', sourceRows: [3] })
    ] }
  ])
  const { periods } = generateNarrative(r)
  const note = periods[0].revenueNotes[0]
  assert.match(note.text, /Revenue exceeded budget by \$2,000/)
  assert.match(note.text, /\(20\.0%\)/)
  assert.equal(note.category, 'favorable')
  // De-duplicated: a non-headline revenue line lives only in Revenue Notes.
  assert.ok(!periods[0].highVariances.some((n) => n.account === 'Revenue'))
})

test('unfavorable expense reads as exceeding budget and surfaces in expense notes', () => {
  const r = result([
    { period: 'ytd', comparisons: [
      ...HEADLINE_FILLERS,
      rec({ account: 'Operating expense', actual: 15000, budget: 10000, accountType: 'expense', category: 'unfavorable', sourceRows: [5] })
    ] }
  ])
  const { periods } = generateNarrative(r)
  const note = periods[0].expenseNotes.find((n) => n.account === 'Operating expense')
  // Phase 14: the line keeps every figure but no longer repeats the period —
  // that is carried by the YTD section heading and the executive summary.
  assert.match(note.text, /Operating expense exceeded budget by \$5,000 \(50\.0%\)\./)
  assert.doesNotMatch(note.text, /year-to-date|current period/)
  assert.equal(note.category, 'unfavorable')
  assert.ok(!periods[0].highVariances.some((n) => n.account === 'Operating expense'))
})

test('favorable expense reads as coming in under budget', () => {
  const r = result([
    { period: 'current', comparisons: [
      ...HEADLINE_FILLERS,
      rec({ account: 'Payroll expense', actual: 8000, budget: 10000, accountType: 'expense', category: 'favorable', sourceRows: [2] })
    ] }
  ])
  const note = generateNarrative(r).periods[0].expenseNotes.find((n) => n.account === 'Payroll expense')
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
  // Phase 14: the period is stated once, up front, in each period's executive
  // summary — Current and YTD stay clearly separated without repeating the
  // phrase on every line note.
  assert.match(periods[0].executiveSummary[0].text, /^For the current period,/)
  assert.match(periods[1].executiveSummary[0].text, /^Year-to-date,/)
  // The line notes themselves carry no period clause.
  assert.doesNotMatch(periods[0].highVariances[0].text, /current period|year-to-date/)
  assert.doesNotMatch(periods[1].highVariances[0].text, /current period|year-to-date/)
})

// --- Phase 14: tighter executive summary -----------------------------------

test('executive summary is a single owner-ready sentence with the totals split', () => {
  const r = result([
    { period: 'current', comparisons: [
      rec({ account: 'Revenue', actual: 13000, budget: 10000, accountType: 'revenue', category: 'favorable', sourceRows: [1] }),
      rec({ account: 'Repairs', actual: 16000, budget: 10000, accountType: 'expense', category: 'unfavorable', sourceRows: [2] })
    ] }
  ])
  const exec = generateNarrative(r).periods[0].executiveSummary
  // One sentence only — the old "Of these, N revenue and N expense…" line is gone.
  assert.equal(exec.length, 1)
  assert.match(exec[0].text, /^For the current period, 2 variances totaling \$9,000 crossed the \$1,000 or 10% thresholds \(1 unfavorable, 1 favorable\)\.$/)
  assert.doesNotMatch(exec[0].text, /Of these/)
})

// --- Phase 14: owner-priority grouping in High Variances -------------------

test('high variances lead with unfavorable rows even when a favorable row is larger', () => {
  const r = result([
    // Favorable revenue with the largest dollar movement.
    { period: 'current', comparisons: [
      rec({ account: 'Big Favorable', actual: 30000, budget: 10000, accountType: 'revenue', category: 'favorable', sourceRows: [1] }),
      // Smaller unfavorable expense — must still appear first (owner watch list).
      rec({ account: 'Small Unfavorable', actual: 12000, budget: 10000, accountType: 'expense', category: 'unfavorable', sourceRows: [2] })
    ] }
  ])
  const order = generateNarrative(r).periods[0].highVariances.map((n) => n.account)
  assert.deepEqual(order, ['Small Unfavorable', 'Big Favorable'])
})

// --- NQ-1B: section de-duplication -----------------------------------------

// Six triggered rows so the headline (top-N by materiality) and the category
// notes are both populated, plus an untyped row that has no category note.
function dedupeFixture() {
  return result([
    { period: 'current', comparisons: [
      rec({ account: 'Exp Big',   actual: 60000, budget: 10000, accountType: 'expense', category: 'unfavorable', sourceRows: [1] }), // 50k headline
      rec({ account: 'Exp Mid',   actual: 50000, budget: 10000, accountType: 'expense', category: 'unfavorable', sourceRows: [2] }), // 40k headline
      rec({ account: 'Rev Big',   actual: 40000, budget: 10000, accountType: 'revenue', category: 'favorable',   sourceRows: [3] }), // 30k headline
      rec({ account: 'Exp Small', actual: 30000, budget: 10000, accountType: 'expense', category: 'unfavorable', sourceRows: [4] }), // 20k expense note
      rec({ account: 'Rev Small', actual: 25000, budget: 10000, accountType: 'revenue', category: 'favorable',   sourceRows: [5] }), // 15k revenue note
      rec({ account: 'Untyped',   actual: 20000, budget: 10000, accountType: 'unknown', category: 'neutral',     sourceRows: [6] })  // 10k → High Variances (no note)
    ] }
  ])
}

test('a variance appears in exactly one section (no High/Revenue/Expense overlap)', () => {
  const p = generateNarrative(dedupeFixture()).periods[0]
  const counts = {}
  for (const sec of ['highVariances', 'revenueNotes', 'expenseNotes'])
    for (const n of p[sec]) counts[n.account] = (counts[n.account] || 0) + 1
  for (const [account, c] of Object.entries(counts))
    assert.equal(c, 1, `${account} should appear once, appeared ${c}×`)
  // No data loss: every triggered account is still narrated somewhere.
  assert.deepEqual(
    Object.keys(counts).sort(),
    ['Exp Big', 'Exp Mid', 'Exp Small', 'Rev Big', 'Rev Small', 'Untyped'].sort()
  )
})

test('High Variances is the top-N material drivers plus any untyped rows', () => {
  assert.equal(HIGH_VARIANCE_HEADLINE_LIMIT, 3)
  const p = generateNarrative(dedupeFixture()).periods[0]
  const high = p.highVariances.map((n) => n.account).sort()
  // Top 3 by materiality (Exp Big 50k, Exp Mid 40k, Rev Big 30k) + the untyped row.
  assert.deepEqual(high, ['Exp Big', 'Exp Mid', 'Rev Big', 'Untyped'].sort())
})

test('headline rows are deferred out of their category notes; the rest remain', () => {
  const p = generateNarrative(dedupeFixture()).periods[0]
  assert.deepEqual(p.revenueNotes.map((n) => n.account), ['Rev Small'])
  assert.deepEqual(p.expenseNotes.map((n) => n.account), ['Exp Small'])
  // Promoted drivers are not relisted in their category note.
  assert.ok(!p.revenueNotes.some((n) => n.account === 'Rev Big'))
  assert.ok(!p.expenseNotes.some((n) => /Exp Big|Exp Mid/.test(n.account)))
})

test('Executive Summary still counts and totals every triggered row, regardless of section', () => {
  const p = generateNarrative(dedupeFixture()).periods[0]
  // 6 triggered rows; totals are unchanged by the de-duplication (thresholds intact).
  assert.match(p.executiveSummary[0].text, /6 variances totaling \$165,000 crossed/)
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

test('an empty-with-reason variance result (flat shape) also produces no periods', () => {
  // computeVariance's empty() shape carries comparisons: [] plus a reason but no
  // comparisonSets. Fabricating a "current" period from it rendered a false
  // "no variances crossed the thresholds" clean bill of health for an
  // uncomparable base; zero periods lets the exports' honest empty message fire.
  const extraction = {
    fileId: 'f1', fileName: 'notes.xlsx', status: 'ok', confidence: 95,
    classification: { type: 'variance-report' },
    normalized: { columns: ['Memo', 'Detail'], rows: [['just', 'text']], accounts: [], dates: [], values: [] }
  }
  const variance = computeVariance(extraction)
  assert.equal(variance.reason, 'no-comparable-columns')
  const n = generateNarrative(variance)
  assert.deepEqual(n.periods, [])
  // The export path states the truth instead of "no variances crossed …".
  const md = narrativeToMarkdown(n)
  assert.match(md, /No comparable variance data was found/)
  assert.doesNotMatch(md, /no variances crossed/i)
})

test('a legacy flat result with zero comparisons and NO reason keeps its single period', () => {
  const n = generateNarrative({ fileId: 'x', fileName: 'flat.pdf', comparisons: [] })
  assert.equal(n.periods.length, 1)
  assert.equal(n.periods[0].period, 'current')
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

// --- Phase 20A.1: base narrative cleanup -----------------------------------

import { isRollupLabel } from '../src/lib/narrative/sections.js'
import { displayAccountLabel } from '../src/lib/narrative/formatters.js'

test('rollup detector flags uncoded TOTAL/NET/GROSS/SUBTOTAL lines only', () => {
  for (const l of ['NET INCOME', 'TOTAL EXPENSES', 'Total Revenue', 'Gross Profit', 'Subtotal — Utilities', 'NET OPERATING INCOME'])
    assert.equal(isRollupLabel(l), true, `${l} should be a rollup`)
  // Coded real accounts are never rollups, even when they start with the words.
  for (const l of ['54110 Real Estate Taxes', '40120 Rental Inc. - Commercial', '51999 Total Recovery Account'])
    assert.equal(isRollupLabel(l), false, `${l} is a coded account`)
  // Named accounts that merely contain the words later (or as a longer word) are
  // not rollups: "Internet"/"Network" must not match the \bnet\b / leading rule.
  for (const l of ['Internet Expense', 'Network Services', 'Grossman Catering'])
    assert.equal(isRollupLabel(l), false, `${l} is a real account`)
})

test('rollup detector tolerates MRI-style leading decoration on subtotals', () => {
  // Real exports print subtotals like "** TOTAL OTHER INCOME"; treating them as
  // account lines narrated and double-counted the aggregate.
  for (const l of ['** TOTAL OTHER INCOME', '  Total Operating Expenses', '* NET OPERATING INCOME', '• Subtotal Utilities'])
    assert.equal(isRollupLabel(l), true, `${l} should be a rollup`)
})

test('rollup detector keeps net/gross-prefixed DETAIL lines narratable', () => {
  // "Gross Potential Rent" / "Gross Scheduled Income" are standard detail income
  // lines on commercial property statements — suppressing them silently hid a
  // $25k variance on the biggest revenue line.
  for (const l of ['Gross Potential Rent', 'Gross Scheduled Income', 'Net Rentable Area Fees'])
    assert.equal(isRollupLabel(l), false, `${l} is a real detail line`)
  // Genuine net/gross aggregates still read as roll-ups.
  for (const l of ['NET CASH FLOW', 'Gross Margin', 'NET INCOME (LOSS)', 'Gross Operating Income'])
    assert.equal(isRollupLabel(l), true, `${l} is a genuine roll-up`)
})

test('a decorated subtotal is excluded and a Gross-prefixed detail line is narrated', () => {
  const r = result([
    { period: 'current', comparisons: [
      rec({ account: '** TOTAL OTHER INCOME', actual: 200000, budget: 150000, accountType: 'revenue', category: 'favorable', sourceRows: [0] }),
      rec({ account: 'Gross Potential Rent', actual: 175000, budget: 200000, accountType: 'revenue', category: 'unfavorable', sourceRows: [1] })
    ] }
  ])
  const p = generateNarrative(r).periods[0]
  // The decorated aggregate is never narrated and never counted.
  for (const sec of ['highVariances', 'revenueNotes', 'expenseNotes'])
    assert.ok(!p[sec].some((n) => /TOTAL OTHER INCOME/.test(n.account)), `rollup leaked into ${sec}`)
  assert.match(p.executiveSummary[0].text, /1 variance totaling \$25,000/)
  // The $25k unfavorable movement on the detail income line leaves a trace.
  assert.ok(p.highVariances.some((n) => n.account === 'Gross Potential Rent'))
})

test('rollup/subtotal lines are excluded from owner-facing variance notes', () => {
  const r = result([
    { period: 'current', comparisons: [
      rec({ account: 'NET INCOME', actual: 200000, budget: 100000, accountType: 'unknown', category: 'neutral', sourceRows: [0] }),
      rec({ account: 'TOTAL EXPENSES', actual: 80000, budget: 50000, accountType: 'expense', category: 'unfavorable', sourceRows: [1] }),
      rec({ account: '54110 Real Estate Taxes', actual: 30000, budget: 20000, accountType: 'expense', category: 'unfavorable', sourceRows: [2] })
    ] }
  ])
  const current = generateNarrative(r).periods[0]
  const accounts = current.highVariances.map((n) => n.account)
  assert.deepEqual(accounts, ['54110 Real Estate Taxes'], 'only the real coded account is narrated')
  // Rollups also do not inflate the executive summary count.
  assert.match(current.executiveSummary[0].text, /1 variance totaling/)
  // And they appear in neither revenue nor expense notes.
  for (const sec of ['revenueNotes', 'expenseNotes', 'highVariances'])
    assert.ok(!current[sec].some((n) => /NET INCOME|TOTAL EXPENSES/.test(n.account)))
})

test('rendered prose strips the leading account code; metadata keeps the coded label', () => {
  const r = result([
    { period: 'current', comparisons: [
      rec({ account: '54110 Real Estate Taxes', actual: 30000, budget: 20000, accountType: 'expense', category: 'unfavorable', sourceRows: [2] })
    ] }
  ])
  const note = generateNarrative(r).periods[0].highVariances[0]
  // Prose: no leading code.
  assert.match(note.text, /^Real Estate Taxes exceeded budget by \$10,000/)
  assert.doesNotMatch(note.text, /^54110|\b54110 Real Estate/)
  // Traceability: the note still carries the original coded label and source row.
  assert.equal(note.account, '54110 Real Estate Taxes')
  assert.deepEqual(note.sourceRows, [2])
})

test('displayAccountLabel strips a leading code but leaves uncoded labels intact', () => {
  assert.equal(displayAccountLabel('54110 Real Estate Taxes'), 'Real Estate Taxes')
  assert.equal(displayAccountLabel('51023 Utility-Gas-Building'), 'Utility-Gas-Building')
  assert.equal(displayAccountLabel('Rental Inc. - Commercial'), 'Rental Inc. - Commercial')
  assert.equal(displayAccountLabel('54110'), '54110') // code-only → fallback, never empty
})
