// Extraction bug-fix regressions — verified-by-execution fixes.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Pins the corrected behavior for:
//   1. GL text fallback — a numeric token at the end of a description ("unit
//      4567") is never absorbed into the trailing money run as the amount;
//   2. GL text netting — a parenthesized/negative debit nets negative (reversal
//      rows), and a genuinely ambiguous two-token run suppresses the amount;
//   3. variance rows — the LAST eight numeric cells are the values, so a label
//      ending in a numeric token ("Salaries 5100") never shifts the cells;
//   4. toNumber — typographic minus survives, date-like and mostly-letters
//      cells are never numbers (and header detection works on "Actual 2026");
//   5. spreadsheet row cap — consistent with the PDF bound, so a routine
//      100+-line statement is read in full;
//   6. filename classification — "Budget Variance Report" is a variance report;
//   9. spreadsheet date cells — formatted from local components (no UTC shift).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'

import { reconstructTable, reconstructSectionedGLFromText, GL_COLUMNS, TABLE_COLUMNS } from '../src/lib/extract/pdfTable.js'
import { MAX_TABLE_ROWS } from '../src/lib/extract/pdfShared.js'
import { toNumber, normalize } from '../src/lib/extract/normalize.js'
import { extractSpreadsheet, cellToText } from '../src/lib/extract/spreadsheet.js'
import { MAX_ROWS } from '../src/lib/extract/extract.js'
import { classifyFile } from '../src/lib/classify.js'
import { isBaseCandidate } from '../src/lib/uploadRouting.js'

function asGL(row) {
  const out = {}
  GL_COLUMNS.forEach((col, i) => (out[col] = row[i]))
  return out
}

function asVariance(row) {
  const out = {}
  TABLE_COLUMNS.forEach((col, i) => (out[col] = row[i]))
  return out
}

// --- 1. GL text fallback: trailing money run is bounded + decimal-only ------

test('a numeric token ending the description is not absorbed as the amount', () => {
  const table = reconstructSectionedGLFromText([
    '5100 Repairs',
    'Balance Forward 0.00',
    '29298 01/26 01/15/2026 CHK 1001 Rent adjustment unit 4567 250.00 0.00 1,250.00'
  ])
  const r = asGL(table.rows[1])
  assert.equal(r.Amount, '250', 'the debit column, not the unit number, is the amount')
  assert.equal(r.Reference, 'CHK 1001')
  assert.match(r.Description, /unit 4567$/, 'the unit number stays in the description')
})

// --- 2. GL text netting: sign preserved / ambiguity suppressed --------------

test('a parenthesized (reversal) debit nets negative, not 0', () => {
  const table = reconstructSectionedGLFromText([
    '5100 Repairs',
    'Balance Forward 0.00',
    '29298 01/26 02/01/2026 JE100 Reversal entry (500.00) 0.00 750.00'
  ])
  assert.equal(asGL(table.rows[1]).Amount, '-500')
})

test('two non-zero money tokens (blank debit cell) suppress the amount', () => {
  // Textually this could be Debit+Credit or Credit+Balance — with no x-positions
  // the sign is unknowable, so no amount is emitted (never a wrong +500).
  const table = reconstructSectionedGLFromText([
    '5100 Repairs',
    'Balance Forward 2,000.00',
    '29298 01/26 02/03/2026 CR300 Tenant credit 500.00 2,500.00'
  ])
  const r = asGL(table.rows[1])
  assert.equal(r.Amount, '', 'ambiguous debit-vs-credit ⇒ no guessed amount')
  assert.match(r.Description, /Tenant credit/, 'the row is still kept for count evidence')
})

test('a zero token still disambiguates a two-token run (existing layouts keep netting)', () => {
  const table = reconstructSectionedGLFromText([
    '5200 Cleaning',
    'Balance Forward',
    '29298 01/26 02/02/2026 CHK9 Monthly clean 800.00 0.00',
    '29298 01/26 02/05/2026 CR12 Vendor refund 0.00 250.00'
  ])
  assert.equal(asGL(table.rows[1]).Amount, '800')
  assert.equal(asGL(table.rows[2]).Amount, '-250')
})

// --- 3. variance rows: values are the LAST eight numeric cells --------------

const VARIANCE_HEADER =
  'Account Actual Budget Variance Var% YTD Actual YTD Budget YTD Variance YTD Var%'

test('a label ending in a numeric token keeps it out of the value cells', () => {
  const table = reconstructTable([
    VARIANCE_HEADER,
    'Salaries 5100 100.00 200.00 (100.00) -50.00% 400.00 500.00 (100.00) -20.00%'
  ])
  const r = asVariance(table.rows[1])
  assert.equal(r.Account, 'Salaries 5100')
  assert.equal(r['Current Actual'], '100.00')
  assert.equal(r['YTD Variance %'], '-20.00%', 'the real last cell is not dropped')
})

test('an integer-suffixed label ("Parking Lot 2") does not shift the cells', () => {
  const table = reconstructTable([
    VARIANCE_HEADER,
    'Parking Lot 2 100 200 300 10% 400 500 600 20%'
  ])
  const r = asVariance(table.rows[1])
  assert.equal(r.Account, 'Parking Lot 2')
  assert.equal(r['Current Actual'], '100')
  assert.equal(r['YTD Variance %'], '20%')
})

// --- 4. toNumber guards ------------------------------------------------------

test('toNumber: typographic minus variants parse as negatives', () => {
  assert.equal(toNumber('−1,234'), -1234) // U+2212 minus sign
  assert.equal(toNumber('–1,234'), -1234) // en dash
})

test('toNumber: date-like cells are never numbers', () => {
  assert.equal(toNumber('1/2/2024'), null)
  assert.equal(toNumber('01/26'), null) // MM/YY period stamp
  assert.equal(toNumber('2024-04-30'), null)
})

test('toNumber: mostly-letters cells are labels; real money cells still parse', () => {
  assert.equal(toNumber('Actual 2026'), null)
  assert.equal(toNumber('$1,234.56'), 1234.56)
  assert.equal(toNumber('(500.00)'), -500)
  assert.equal(toNumber('1,234.56 CR'), 1234.56)
})

test('a year-suffixed value header ("Actual 2026") is detected past metadata rows', () => {
  const grid = [
    ['Database: DEMO', '', ''],
    ['Account', 'Actual 2026', 'Budget 2026'],
    ['Rent', '1200', '1000'],
    ['Utilities', '500', '450']
  ]
  const { normalized } = normalize({ tables: [{ rows: grid }] }, 'spreadsheet')
  assert.deepEqual(normalized.columns, ['Account', 'Actual 2026', 'Budget 2026'])
  assert.deepEqual(normalized.rows.map((r) => r[0]), ['Rent', 'Utilities'])
})

test('a variance row printed with U+2212 minus is reconstructed, not dropped', () => {
  const table = reconstructTable([
    VARIANCE_HEADER,
    'Utility-Elect-Building 614.81 530.00 −84.81 −16.00% 5,896.96 5,420.00 −476.96 −8.80%'
  ])
  assert.ok(table, 'the row must reconstruct')
  const r = asVariance(table.rows[1])
  assert.equal(r['Current Variance'], '-84.81')
  assert.equal(r['YTD Variance'], '-476.96')
})

// --- 5. spreadsheet row cap ---------------------------------------------------

// Serialize a grid into a minimal file-like object (same helper shape as
// test/nq6c3.test.js) so the parser's real truncation path runs.
function xlsxFile(grid, name = 'statement.xlsx') {
  const ws = XLSX.utils.aoa_to_sheet(grid)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const u8 = out instanceof Uint8Array ? out : new Uint8Array(out)
  const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
  return { name, size: u8.byteLength, arrayBuffer: async () => ab }
}

test('MAX_ROWS matches the PDF bound and a 120-row statement reads in full', async () => {
  assert.equal(MAX_ROWS, MAX_TABLE_ROWS)
  const grid = [['Account', 'Actual', 'Budget']]
  for (let i = 0; i < 120; i++) grid.push([`Account ${i}`, String(i * 10), String(i * 9)])
  const extracted = await extractSpreadsheet(xlsxFile(grid), MAX_ROWS)
  assert.equal(extracted.metadata.rowsRead, grid.length)
  assert.equal(extracted.metadata.truncated, false)
})

// --- 6. filename classification precedence ------------------------------------

test('"Budget Variance Report" classifies as a variance report (base candidate)', () => {
  assert.equal(classifyFile({ name: 'Budget Variance Report.pdf' }).type, 'Existing Variance Report')
  assert.equal(isBaseCandidate({ name: 'Budget Variance Report.pdf' }), true)
})

test('plain budget/forecast names still classify as Budget', () => {
  assert.equal(classifyFile({ name: 'Budget.xlsx' }).type, 'Budget')
  assert.equal(classifyFile({ name: '2026 Forecast.xlsx' }).type, 'Budget')
})

// --- 9. spreadsheet date cells --------------------------------------------------

test('a date cell formats from local components (no UTC day shift)', () => {
  assert.equal(cellToText(new Date(2026, 0, 15)), '2026-01-15')
  // Late-evening local time must not roll to the next UTC day.
  assert.equal(cellToText(new Date(2026, 0, 15, 23, 30)), '2026-01-15')
})
