// Grouped / multi-row header tests — Phase 13.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Covers the normalizer's support for a two-row header band (a group/period row
// over repeated value sub-headers), the merged-cell case (group cells emitted as
// blanks), the preserved single-row/flat behavior, and that a real grouped
// workbook now flows all the way through variance + narrative + both exports.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalize } from '../src/lib/extract/normalize.js'
import { computeVariance } from '../src/lib/variance/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'
import { narrativeToDocxBlocks } from '../src/lib/export/docx.js'
import { buildExcelModel } from '../src/lib/export/excel.js'

// Wrap an array-of-arrays grid the way the spreadsheet parser hands it over.
function spreadsheet(grid) {
  return { text: [], tables: [{ name: 'Sheet1', rows: grid, columnCount: grid[0]?.length || 0 }], metadata: {} }
}

// The Comparative Income Statement shape: a merged group band (blanks where the
// merge spans) over Actual | Budget | Variance, twice.
const GROUPED_MERGED = [
  ['', 'Current Period', '', '', 'Year-To-Date', '', ''],
  ['Account', 'Actual', 'Budget', 'Variance', 'Actual', 'Budget', 'Variance'],
  ['Rental Income', '130000', '100000', '30000', '700000', '600000', '100000'],
  ['Repairs Expense', '60000', '40000', '20000', '300000', '250000', '50000'],
  ['Reserves', '', '20000', '', '', '120000', '']
]

const EXPECTED_COLUMNS = [
  'Account',
  'Current Period Actual',
  'Current Period Budget',
  'Current Period Variance',
  'Year-To-Date Actual',
  'Year-To-Date Budget',
  'Year-To-Date Variance'
]

// --- header folding --------------------------------------------------------

test('grouped header with merged (blank) group cells folds into combined columns', () => {
  const { normalized } = normalize(spreadsheet(GROUPED_MERGED), 'spreadsheet')
  assert.deepEqual(normalized.columns, EXPECTED_COLUMNS)
  // The value sub-header row is consumed by the header, not left in the data.
  assert.equal(normalized.rows.length, 3)
  assert.deepEqual(normalized.rows.map((r) => r[0]), ['Rental Income', 'Repairs Expense', 'Reserves'])
})

test('grouped header detected via period keywords when group labels repeat (no merge blanks)', () => {
  const grid = [
    ['Account', 'Current', 'Current', 'Current', 'YTD', 'YTD', 'YTD'],
    ['', 'Actual', 'Budget', 'Variance', 'Actual', 'Budget', 'Variance'],
    ['Rental Income', '130000', '100000', '30000', '700000', '600000', '100000']
  ]
  const { normalized } = normalize(spreadsheet(grid), 'spreadsheet')
  assert.deepEqual(normalized.columns, [
    'Account', 'Current Actual', 'Current Budget', 'Current Variance', 'YTD Actual', 'YTD Budget', 'YTD Variance'
  ])
  assert.equal(normalized.rows.length, 1)
})

// --- preserved flat behavior ----------------------------------------------

test('a flat single-row header is unchanged (existing CSV/simple-table behavior)', () => {
  const grid = [
    ['Account', 'Actual', 'Budget'],
    ['Rent', '1200', '1000'],
    ['Utilities', '500', '450']
  ]
  const { normalized } = normalize(spreadsheet(grid), 'spreadsheet')
  assert.deepEqual(normalized.columns, ['Account', 'Actual', 'Budget'])
  assert.equal(normalized.rows.length, 2)
})

test('a header plus a single data row is NOT mistaken for a header band', () => {
  const grid = [
    ['Account', 'Actual', 'Budget'],
    ['Rent', '1200', '1000']
  ]
  const { normalized } = normalize(spreadsheet(grid), 'spreadsheet')
  assert.deepEqual(normalized.columns, ['Account', 'Actual', 'Budget'])
  assert.equal(normalized.rows.length, 1)
})

test('a flat Current/YTD header (single row) still works without folding', () => {
  const grid = [
    ['Account', 'Current Actual', 'Current Budget', 'YTD Actual', 'YTD Budget'],
    ['Rental Income', '130000', '100000', '700000', '600000']
  ]
  const { normalized } = normalize(spreadsheet(grid), 'spreadsheet')
  assert.deepEqual(normalized.columns, ['Account', 'Current Actual', 'Current Budget', 'YTD Actual', 'YTD Budget'])
  assert.equal(normalized.rows.length, 1)
})

// --- end-to-end through the variance + narrative + export pipeline ----------

function groupedExtraction() {
  const { normalized, confidence } = normalize(spreadsheet(GROUPED_MERGED), 'spreadsheet')
  return {
    fileId: 'f1',
    fileName: 'Comparative Income Statement.xlsx',
    status: 'ok',
    confidence,
    classification: { type: 'variance-report' },
    normalized
  }
}

test('variance detects both Current and YTD comparison sets from the grouped workbook', () => {
  const result = computeVariance(groupedExtraction())
  assert.equal(result.reason, undefined) // no "no-comparable-columns"
  assert.deepEqual(result.comparisonSets.map((s) => s.period), ['current', 'ytd'])
  const current = result.comparisonSets.find((s) => s.period === 'current')
  assert.deepEqual(
    { actual: current.columns.actual, budget: current.columns.budget },
    { actual: 1, budget: 2 }
  )
  const ytd = result.comparisonSets.find((s) => s.period === 'ytd')
  assert.deepEqual({ actual: ytd.columns.actual, budget: ytd.columns.budget }, { actual: 4, budget: 5 })
})

test('grouped workbook produces correct variance math and flags the right rows', () => {
  const current = computeVariance(groupedExtraction()).comparisonSets.find((s) => s.period === 'current')
  const byName = Object.fromEntries(current.comparisons.map((c) => [c.account, c]))
  assert.equal(byName['Rental Income'].varianceAmount, 30000)
  assert.equal(byName['Rental Income'].thresholdTriggered, true)
  assert.equal(byName['Rental Income'].category, 'favorable')
  assert.equal(byName['Repairs Expense'].varianceAmount, 20000)
  assert.equal(byName['Repairs Expense'].category, 'unfavorable')
  assert.equal(byName['Reserves'].missingData, true)
})

test('grouped workbook narrates and exports to Markdown + DOCX (Current + YTD)', () => {
  const narrative = generateNarrative(computeVariance(groupedExtraction()))
  assert.deepEqual(narrative.periods.map((p) => p.period), ['current', 'ytd'])

  const md = narrativeToMarkdown(narrative)
  assert.ok(md.includes('Rental Income'), 'Markdown missing a triggered row')
  assert.ok(md.includes('Repairs Expense'), 'Markdown missing a triggered row')
  assert.match(md, /## Current/)
  assert.match(md, /## YTD/)

  const blocks = narrativeToDocxBlocks(narrative)
  const text = blocks.map((b) => b.text).join('\n')
  assert.ok(text.includes('Rental Income') && text.includes('Repairs Expense'))
  assert.deepEqual(blocks.filter((b) => b.kind === 'period').map((b) => b.text), ['Current', 'YTD'])
})

// --- unlabeled YTD band: value sub-labels printed only under Current ---------
// A real comparative income statement whose merged "Year-To-Date" group band
// does NOT repeat the Actual/Budget/Variance/Variance % sub-headers — they
// appear only under "Current Period". After folding, the YTD columns carry just
// the period label, so the YTD value columns must be recovered positionally or
// every YTD column in the Excel export comes back null. This reproduces the
// reported bug (Current reads fine, YTD null) and locks in the fix end-to-end.
const UNLABELED_YTD = [
  ['', 'Current Period', '', '', '', 'Year-To-Date', '', '', ''],
  ['Account', 'Actual', 'Budget', 'Variance', 'Variance %', '', '', '', ''],
  ['Rental Income', '130000', '100000', '30000', '30', '700000', '600000', '100000', '16.7'],
  ['Repairs Expense', '60000', '40000', '20000', '50', '300000', '250000', '50000', '20']
]

test('YTD columns parse and flow to the Excel export when only Current carries sub-labels', () => {
  const { normalized, confidence } = normalize(spreadsheet(UNLABELED_YTD), 'spreadsheet')
  const result = computeVariance({
    fileId: 'f1', fileName: 'Comparative Income Statement.xlsx',
    status: 'ok', confidence, classification: { type: 'variance-report' }, normalized
  })
  assert.deepEqual(result.comparisonSets.map((s) => s.period), ['current', 'ytd'])

  const model = buildExcelModel(generateNarrative(result), {})
  const rental = model.ownerRows.find((r) => r.account === 'Rental Income')
  // Current side still reads exactly as before.
  assert.equal(rental.currentActual, 130000)
  assert.equal(rental.currentComparison, 100000)
  // YTD side now carries real numbers instead of null.
  assert.equal(rental.ytdActual, 700000)
  assert.equal(rental.ytdComparison, 600000)
  assert.equal(rental.ytdVarianceAmount, 100000)
  assert.ok(Math.abs(rental.ytdVariancePercent - 16.6667) < 0.01)
})

// --- flat duplicated header with NO period band (the reported regression) -----
// Some exports drop the merged "Current Period | Year-To-Date" band entirely,
// leaving a single flat header row that simply REPEATS "Actual | Budget |
// Variance | Variance %" twice with no period marker. The second block is the
// YTD figures (cols 5–8); without splitting it positionally those columns are
// discarded as duplicates and every YTD cell in the Owner Summary is null.
const FLAT_DUPLICATE = [
  ['Account', 'Actual', 'Budget', 'Variance', 'Variance %', 'Actual', 'Budget', 'Variance', 'Variance %'],
  ['Rental Inc. - Commercial', '661061.20', '661061.20', '0', '0', '2644244.80', '2644244.80', '0', '0'],
  ['Repairs Expense', '60000', '40000', '20000', '50', '300000', '250000', '50000', '20']
]

test('YTD columns flow to the Excel export from a flat duplicated header with no period band', () => {
  const { normalized, confidence } = normalize(spreadsheet(FLAT_DUPLICATE), 'spreadsheet')
  const result = computeVariance({
    fileId: 'f1', fileName: 'Comparative Income Statement.xlsx',
    status: 'ok', confidence, classification: { type: 'variance-report' }, normalized
  })
  assert.deepEqual(result.comparisonSets.map((s) => s.period), ['current', 'ytd'])

  const model = buildExcelModel(generateNarrative(result), {})
  const rental = model.ownerRows.find((r) => r.account === 'Rental Inc. - Commercial')
  // Current side reads from cols 1–2.
  assert.equal(rental.currentActual, 661061.2)
  assert.equal(rental.currentComparison, 661061.2)
  // YTD side reads from cols 5–6 (real numbers, not null).
  assert.equal(rental.ytdActual, 2644244.8)
  assert.equal(rental.ytdComparison, 2644244.8)
  assert.equal(rental.ytdVarianceAmount, 0)
})
