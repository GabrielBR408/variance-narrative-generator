// --- pdfTable harness — Phase 7.1 QA regression ---------------------------
// Deterministic, dependency-free checks for PDF variance-table reconstruction.
// Run with: npm test   (node tests/pdfTable.test.mjs)
//
// Focus: numeric cells must map STRICTLY by order to the nine normalized
// columns, and a line whose text items arrive out of visual order (the real
// pdf.js failure mode behind the Phase 7.1 blocker) must be reordered before
// parsing so Current Budget and Current Variance are never swapped.

import {
  reconstructTable,
  groupItemsIntoLines,
  TABLE_COLUMNS
} from '../src/lib/extract/pdfTable.js'

let failures = 0
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.log(`  FAIL ${name}\n       expected ${e}\n       actual   ${a}`)
  }
}

// Map a reconstructed data row to a {column: value} object for readable asserts.
function asMapped(row) {
  const out = {}
  TABLE_COLUMNS.forEach((col, i) => {
    out[col] = row[i]
  })
  return out
}

// The exact blocker row from `05.26 73264 Income Statement.pdf`.
const UTILITY_ROW =
  'Utility-Elect-Building 614.81 530.00 (84.81) -16.00% 5,896.96 5,420.00 (476.96) -8.80%'

const UTILITY_EXPECTED = {
  Account: 'Utility-Elect-Building',
  'Current Actual': '614.81',
  'Current Budget': '530.00',
  'Current Variance': '-84.81',
  'Current Variance %': '-16.00%',
  'YTD Actual': '5896.96',
  'YTD Budget': '5420.00',
  'YTD Variance': '-476.96',
  'YTD Variance %': '-8.80%'
}

// Rental Inc. - Commercial regression (current-period columns only asserted).
const RENTAL_ROW =
  'Rental Inc. - Commercial 29,522.70 37,397.50 (7,874.80) -21.06% 295,227.00 373,975.00 (78,748.00) -21.06%'

const HEADER =
  'Account Actual Budget Variance Var% YTD Actual YTD Budget YTD Variance YTD Var%'

function firstDataRow(lines) {
  const table = reconstructTable(lines)
  if (!table || table.rows.length < 2) return null
  return asMapped(table.rows[1])
}

console.log('Phase 7.1 — pdfTable mapping')

// 1. The exact blocker row maps strictly by order.
check('utility row maps by order', firstDataRow([HEADER, UTILITY_ROW]), UTILITY_EXPECTED)

// 2. Rental Inc. - Commercial current-period columns map correctly.
const rental = firstDataRow([HEADER, RENTAL_ROW])
check('rental account', rental && rental.Account, 'Rental Inc. - Commercial')
check('rental current actual', rental && rental['Current Actual'], '29522.70')
check('rental current budget', rental && rental['Current Budget'], '37397.50')
check('rental current variance', rental && rental['Current Variance'], '-7874.80')
check('rental current variance %', rental && rental['Current Variance %'], '-21.06%')

// 3. Out-of-order text items (pdf.js content-stream order) get reordered by x.
//    Here Current Budget and Current Variance are emitted swapped in the stream,
//    but their x-positions are correct, so grouping must restore left-to-right.
const X = {
  account: 50,
  cActual: 200,
  cBudget: 270,
  cVariance: 340,
  cVarPct: 410,
  yActual: 480,
  yBudget: 560,
  yVariance: 640,
  yVarPct: 710
}
const item = (str, x, hasEOL = false) => ({ str, transform: [1, 0, 0, 1, x, 700], hasEOL })

// Stream order: Budget and Variance arrive swapped (Variance before Budget).
const outOfOrderItems = [
  item('Utility-Elect-Building', X.account),
  item('614.81', X.cActual),
  item('(84.81)', X.cVariance), // <-- emitted before Budget
  item('530.00', X.cBudget),
  item('-16.00%', X.cVarPct),
  item('5,896.96', X.yActual),
  item('5,420.00', X.yBudget),
  item('(476.96)', X.yVariance),
  item('-8.80%', X.yVarPct, true)
]

const orderedLines = groupItemsIntoLines(outOfOrderItems)
check('out-of-order items reordered to one clean line', orderedLines, [UTILITY_ROW])

// Full pipeline: out-of-order items -> grouped/ordered line -> reconstructed row.
check(
  'out-of-order items still map by order end-to-end',
  firstDataRow([HEADER, ...orderedLines]),
  UTILITY_EXPECTED
)

// 4. Already-ordered items are left unchanged (stable sort, no regression).
const inOrderItems = [
  item('Utility-Elect-Building', X.account),
  item('614.81', X.cActual),
  item('530.00', X.cBudget),
  item('(84.81)', X.cVariance),
  item('-16.00%', X.cVarPct),
  item('5,896.96', X.yActual),
  item('5,420.00', X.yBudget),
  item('(476.96)', X.yVariance),
  item('-8.80%', X.yVarPct, true)
]
check('already-ordered items unchanged', groupItemsIntoLines(inOrderItems), [UTILITY_ROW])

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
