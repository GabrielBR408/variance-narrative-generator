// Fix 1 regression — single-period PDF income statements.
//
// A common single-period PDF lays out one Actual/Budget/Variance block only
// (no YTD), so each row carries THREE numeric cells. The comparative 8-cell
// ROW_RE never matched it, so the file parsed to no table ("Rows 1 / Columns 0")
// and Generate produced nothing. These pin the single-period path AND prove the
// comparative (9-column) path is unchanged.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  reconstructTable,
  detectSinglePeriodReport,
  SINGLE_PERIOD_COLUMNS,
  TABLE_COLUMNS
} from '../src/lib/extract/pdfTable.js'
import { normalize } from '../src/lib/extract/normalize.js'
import { computeVariance } from '../src/lib/variance/index.js'
import { DEFAULT_THRESHOLDS } from '../src/lib/variance/thresholds.js'

const SP_HEADER = 'Account Actual Budget Variance'
const SP_ROWS = [
  'Rental Income 100,000.00 95,000.00 5,000.00',
  'Parking Income 12,500.00 12,000.00 500.00',
  'Utilities (8,200.00) (7,500.00) (700.00)',
  'Repairs 15,000.00 9,000.00 6,000.00',
  'Insurance 3,400.00 3,400.00 0.00',
  'Management Fee 6,000.00 6,000.00 0.00',
  'Landscaping 2,100.00 1,800.00 300.00'
]

function asRow(columns, row) {
  const out = {}
  columns.forEach((c, i) => (out[c] = row[i]))
  return out
}

// --- 1. Single-period layout extracts all rows into 4 columns ---------------

test('a 7-row single-period statement extracts all rows and the right columns', () => {
  const table = reconstructTable([SP_HEADER, ...SP_ROWS])
  assert.ok(table, 'a table must reconstruct (was null before the fix)')
  assert.deepEqual(table.rows[0], [...SINGLE_PERIOD_COLUMNS])
  assert.equal(table.rows.length - 1, 7, 'all seven data rows are kept')

  const repairs = asRow(SINGLE_PERIOD_COLUMNS, table.rows[4])
  assert.deepEqual(repairs, {
    Account: 'Repairs',
    Actual: '15000.00',
    Budget: '9000.00',
    Variance: '6000.00'
  })

  const utilities = asRow(SINGLE_PERIOD_COLUMNS, table.rows[3])
  assert.equal(utilities.Actual, '-8200.00', 'accounting negatives survive')
  assert.equal(utilities.Variance, '-700.00')
})

// --- 2. The extracted table computes variances correctly downstream ---------

test('single-period extraction computes variances (Repairs flags, Insurance does not)', () => {
  const table = reconstructTable([SP_HEADER, ...SP_ROWS])
  const { normalized } = normalize({ text: [], tables: [table], metadata: {} }, 'pdf')
  assert.deepEqual(normalized.columns, [...SINGLE_PERIOD_COLUMNS])

  const variance = computeVariance({ normalized }, DEFAULT_THRESHOLDS)
  assert.deepEqual(variance.columns, { account: 0, actual: 1, budget: 2, prior: null })

  const byAccount = Object.fromEntries(variance.comparisons.map((c) => [c.account, c]))
  assert.equal(byAccount['Repairs'].varianceAmount, 6000)
  assert.equal(byAccount['Repairs'].thresholdTriggered, true)
  assert.equal(byAccount['Insurance'].varianceAmount, 0)
  assert.equal(byAccount['Insurance'].thresholdTriggered, false)
})

// --- 3. The comparative (9-column) path is unchanged ------------------------

const COMP_HEADER =
  'Account Actual Budget Variance Var% YTD Actual YTD Budget YTD Variance YTD Var%'
const COMP_ROW =
  'Utility-Elect-Building 614.81 530.00 (84.81) -16.00% 5,896.96 5,420.00 (476.96) -8.80%'

test('a comparative statement still reconstructs into the 9 comparative columns', () => {
  const table = reconstructTable([COMP_HEADER, COMP_ROW])
  assert.deepEqual(table.rows[0], [...TABLE_COLUMNS])
  assert.equal(table.columnCount, 9)
  const r = asRow(TABLE_COLUMNS, table.rows[1])
  assert.equal(r['Current Actual'], '614.81')
  assert.equal(r['YTD Variance'], '-476.96')
})

// --- 4. Layout detection is mutually exclusive on YTD -----------------------

test('detectSinglePeriodReport is true for single-period and false when YTD is present', () => {
  assert.equal(detectSinglePeriodReport([SP_HEADER, ...SP_ROWS]), true)
  assert.equal(detectSinglePeriodReport([COMP_HEADER, COMP_ROW]), false)
})

// --- 5. A single row with a header still extracts (report signature) --------

test('one single-period data row is enough when the header signature is present', () => {
  const table = reconstructTable([SP_HEADER, SP_ROWS[3]])
  assert.ok(table)
  assert.equal(table.rows.length - 1, 1)
  assert.equal(table.rows[1][0], 'Repairs')
})

// --- 6. Unrelated text does not produce a phantom single-period table -------

test('prose with no report header does not become a single-period table', () => {
  const table = reconstructTable([
    'This is a memo about the building.',
    'It mentions one figure 1234 and nothing else.'
  ])
  assert.equal(table, null)
})
