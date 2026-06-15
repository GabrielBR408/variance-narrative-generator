// Metadata-leading header tests — Phase 13B.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Real exports (e.g. a Lincoln Property "Comparative Income Statement") print
// several report-metadata rows before the table. These cover skipping that
// metadata to find the real header block — grouped or flat — while preserving
// the Phase 13 top-of-sheet behavior and never inventing a header on a
// metadata-only sheet.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalize } from '../src/lib/extract/normalize.js'
import { computeVariance } from '../src/lib/variance/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'
import { narrativeToDocxBlocks } from '../src/lib/export/docx.js'

function spreadsheet(grid) {
  return { text: [], tables: [{ name: 'Sheet1', rows: grid, columnCount: grid[0]?.length || 0 }], metadata: {} }
}

// Five leading metadata rows, then a merged group band over Actual/Budget/
// Variance (twice), then accounts — the faithful real-file shape.
const METADATA_GROUPED = [
  ['Database: LPCWEST', 'Comparative Income Statement', '', '', '', 'Page:', ''],
  ['PROJ', 'CASH FLOW', '', '', '', 'Date:', ''],
  ['Lincoln Property Company', '', '', '', '', 'Time:', ''],
  ['Property: Westgate Plaza', '', '', '', '', '', ''],
  ['Accrual', '', '', '', '', '', ''],
  ['', 'Current Period', '', '', 'Year-To-Date', '', ''],
  ['Account', 'Actual', 'Budget', 'Variance', 'Actual', 'Budget', 'Variance'],
  ['Rental Income', '130000', '100000', '30000', '700000', '600000', '100000'],
  ['Repairs Expense', '60000', '40000', '20000', '300000', '250000', '50000'],
  ['Reserves', '', '20000', '', '', '120000', '']
]

const EXPECTED_GROUPED_COLUMNS = [
  'Account',
  'Current Period Actual',
  'Current Period Budget',
  'Current Period Variance',
  'Year-To-Date Actual',
  'Year-To-Date Budget',
  'Year-To-Date Variance'
]

// --- metadata before a grouped header --------------------------------------

test('skips leading metadata rows and folds the grouped header below them', () => {
  const { normalized } = normalize(spreadsheet(METADATA_GROUPED), 'spreadsheet')
  assert.deepEqual(normalized.columns, EXPECTED_GROUPED_COLUMNS)
  assert.deepEqual(normalized.rows.map((r) => r[0]), ['Rental Income', 'Repairs Expense', 'Reserves'])
})

test('metadata + grouped header flows through variance with Current + YTD', () => {
  const { normalized, confidence } = normalize(spreadsheet(METADATA_GROUPED), 'spreadsheet')
  const result = computeVariance({
    fileId: 'f1', fileName: 'Comparative Income Statement.xlsx',
    status: 'ok', confidence, classification: { type: 'variance-report' }, normalized
  })
  assert.equal(result.reason, undefined)
  assert.deepEqual(result.comparisonSets.map((s) => s.period), ['current', 'ytd'])
  const current = result.comparisonSets.find((s) => s.period === 'current')
  const byName = Object.fromEntries(current.comparisons.map((c) => [c.account, c]))
  assert.equal(byName['Rental Income'].varianceAmount, 30000)
  assert.equal(byName['Repairs Expense'].varianceAmount, 20000)
  assert.equal(byName['Reserves'].missingData, true)
})

test('metadata + grouped header narrates and exports figures (Markdown + DOCX)', () => {
  const { normalized } = normalize(spreadsheet(METADATA_GROUPED), 'spreadsheet')
  const narrative = generateNarrative(computeVariance({
    fileId: 'f1', fileName: 'Comparative Income Statement.xlsx',
    status: 'ok', confidence: 95, classification: { type: 'variance-report' }, normalized
  }))
  const md = narrativeToMarkdown(narrative)
  assert.ok(md.includes('Rental Income') && md.includes('$30,000'), 'Markdown missing a figure')
  assert.match(md, /## Current/)
  assert.match(md, /## YTD/)
  const text = narrativeToDocxBlocks(narrative).map((b) => b.text).join('\n')
  assert.ok(text.includes('Rental Income') && text.includes('$30,000'), 'DOCX missing a figure')
})

// --- metadata before a flat header -----------------------------------------

test('skips leading metadata rows and finds a flat header below them', () => {
  const grid = [
    ['Database: LPCWEST', 'Comparative Income Statement', ''],
    ['Lincoln Property Company', '', ''],
    ['Accrual', '', ''],
    ['Account', 'Actual', 'Budget'],
    ['Rent', '1200', '1000'],
    ['Utilities', '500', '450']
  ]
  const { normalized } = normalize(spreadsheet(grid), 'spreadsheet')
  // The metadata row directly above the flat header (no period keyword) is NOT
  // folded into it.
  assert.deepEqual(normalized.columns, ['Account', 'Actual', 'Budget'])
  assert.deepEqual(normalized.rows.map((r) => r[0]), ['Rent', 'Utilities'])
})

// --- preserved Phase 13 / flat behavior ------------------------------------

test('existing grouped header at the top of the sheet still folds (Phase 13)', () => {
  const grid = [
    ['', 'Current Period', '', '', 'Year-To-Date', '', ''],
    ['Account', 'Actual', 'Budget', 'Variance', 'Actual', 'Budget', 'Variance'],
    ['Rental Income', '130000', '100000', '30000', '700000', '600000', '100000']
  ]
  const { normalized } = normalize(spreadsheet(grid), 'spreadsheet')
  assert.deepEqual(normalized.columns, EXPECTED_GROUPED_COLUMNS)
  assert.equal(normalized.rows.length, 1)
})

test('existing flat single-row header at the top is unchanged', () => {
  const grid = [
    ['Account', 'Actual', 'Budget'],
    ['Rent', '1200', '1000'],
    ['Utilities', '500', '450']
  ]
  const { normalized } = normalize(spreadsheet(grid), 'spreadsheet')
  assert.deepEqual(normalized.columns, ['Account', 'Actual', 'Budget'])
  assert.equal(normalized.rows.length, 2)
})

// --- no false positives ----------------------------------------------------

test('a metadata-only sheet invents no header and reports no comparison', () => {
  const grid = [
    ['Database: LPCWEST', 'Comparative Income Statement', ''],
    ['PROJ', 'CASH FLOW', ''],
    ['Lincoln Property Company', '', ''],
    ['Property: Westgate Plaza', '', ''],
    ['Accrual', '', '']
  ]
  const { normalized } = normalize(spreadsheet(grid), 'spreadsheet')
  // Falls back to the first row; no value-header row is fabricated.
  assert.deepEqual(normalized.columns, ['Database: LPCWEST', 'Comparative Income Statement', ''])
  const result = computeVariance({
    fileId: 'f1', fileName: 'meta.xlsx', status: 'ok', confidence: 95,
    classification: { type: 'variance-report' }, normalized
  })
  assert.equal(result.reason, 'no-comparable-columns')
})

test('"Accrual" and similar metadata words are not mistaken for value headers', () => {
  // Single value-ish word is below the >= 2 keyword bar, so no header is found.
  const grid = [
    ['Accrual', '', ''],
    ['Cash Basis', '', ''],
    ['Notes', '', '']
  ]
  const { normalized } = normalize(spreadsheet(grid), 'spreadsheet')
  assert.deepEqual(normalized.columns, ['Accrual', '', ''])
})
