// Phase A tests — GL Enrichment + PDF Parser Fix
//
// BUG 1 — GL enrichment not connecting to income statement lines.
//   A multi-entity (sectioned, text-based) PDF GL prints account headings as
//   "<site> <account-code> <Name>" (e.g. "715141 40120 Rental Income"). The text
//   reconstructor's heading regex required exactly ONE leading numeric token
//   followed by a letter, so a two-code heading was dropped entirely → no account
//   section opened → zero GL rows → a NULL table → generic "should be reviewed"
//   narrative. The position-aware path kept the heading but led with the ENTITY
//   code, collapsing the strong code-tier match. Both now key off the ACCOUNT
//   code (the last leading numeric token), with the entity/site prefix dropped.
//
// BUG 2 — PDF income statement returns "no table found".
//   A comparative P&L whose non-standard font/encoding decodes to garbled glyphs
//   yields text but no figures, so no table reconstructs and variance reports
//   "not-tabular". Such an extraction is now detected (looksGarbledText) and the
//   base report is routed to the income-statement OCR path, whose recovered rows
//   map to the normalized variance table the variance engine already consumes.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  reconstructTable,
  reconstructSectionedGLFromText,
  groupItemsIntoLineCells,
  looksGarbledText,
  GL_COLUMNS,
  TABLE_COLUMNS
} from '../src/lib/extract/pdfTable.js'
import { normalize } from '../src/lib/extract/normalize.js'
import { buildEvidenceIndex, matchAccount, accountCode } from '../src/lib/enrich/match.js'
import { rowsToTable } from '../src/lib/ocr/ocrTable.js'
import { isGarbledPdf, isScannedPdf } from '../src/lib/ocr/augment.js'
import { parseOcrRows, buildOcrContent } from '../server/ocr.js'
import { computeVariance } from '../src/lib/variance/index.js'

// --- BUG 1: multi-entity sectioned GL --------------------------------------

// A Northpark-style multi-entity GL: sites 715141/715142/715143, "Balance
// Forward" openers, "Account Id Code" account codes (40120, 51051, 53110), and
// "** Account Totals" section ends. Each heading is "<site> <account-code> <Name>".
function multiEntityGlLines() {
  return [
    'Period Entry Date Src Reference Description Debit Credit Balance',
    '715141 40120 Rental Income',
    'Balance Forward 0.00',
    '715141 01/26 01/15/2026 INV900 Tenant rent collected 0.00 12000.00 12000.00',
    '715141 01/26 01/31/2026 INV950 Tenant rent collected 0.00 12000.00 24000.00',
    '** Account Totals 0.00 24000.00 24000.00',
    '715142 51051 Security Contract',
    'Balance Forward 0.00',
    '715142 01/26 01/20/2026 CHK1200 SecureGuard LLC 4000.00 0.00 4000.00',
    '** Account Totals 4000.00 0.00 4000.00',
    '715143 53110 Repairs & Maintenance',
    'Balance Forward 0.00',
    '715143 01/26 01/22/2026 INV777 Roof repair AceRoofing 5500.00 0.00 5500.00',
    '** Account Totals 5500.00 0.00 5500.00'
  ]
}

test('BUG 1: multi-entity headings reconstruct rows keyed off the ACCOUNT code', () => {
  const table = reconstructSectionedGLFromText(multiEntityGlLines())
  assert.ok(table, 'a table is reconstructed (not null)')
  const accounts = table.rows.slice(1).map((r) => r[0])
  // The leading site code (715141/...) is dropped; the account code (40120/...) leads.
  assert.deepEqual(accounts, [
    '40120 Rental Income',
    '40120 Rental Income',
    '51051 Security Contract',
    '53110 Repairs & Maintenance'
  ])
  assert.deepEqual(table.rows.slice(1).map((r) => accountCode(r[0])), ['40120', '40120', '51051', '53110'])
})

test('BUG 1: a single-entity heading is unchanged (no regression)', () => {
  const table = reconstructSectionedGLFromText([
    '5100 Repairs',
    'Balance Forward 0.00',
    '29298 01/26 03/01/2026 INV1 Roof repair 1200.00 0.00 1200.00',
    '** Account Totals 1200.00 0.00 1200.00'
  ])
  assert.equal(table.rows[1][0], '5100 Repairs')
})

test('BUG 1: GL rows match income-statement lines by account code (exact_code 1.0)', () => {
  const table = reconstructTable(multiEntityGlLines(), { classificationType: 'General Ledger (GL)' })
  const { normalized } = normalize({ tables: [table] }, 'pdf')
  const idx = buildEvidenceIndex([
    { fileName: 'Northpark GL.pdf', status: 'ok', classification: { type: 'General Ledger (GL)' }, normalized }
  ])
  const expect = { '40120 Rental Income': 1.0, '51051 Security Contract': 1.0, '53110 Repairs & Maintenance': 1.0 }
  for (const [line, conf] of Object.entries(expect)) {
    const cites = matchAccount(line, idx)
    assert.equal(cites.length, 1, `${line} has a citation`)
    assert.equal(cites[0].confidence, conf, `${line} matches by code`)
    assert.equal(cites[0].matchMethod, 'exact_code', `${line} via exact_code`)
    assert.equal(cites[0].thick, true)
  }
})

test('BUG 1: an income-statement line WITHOUT a code still matches by name', () => {
  const table = reconstructTable(multiEntityGlLines(), { classificationType: 'General Ledger (GL)' })
  const { normalized } = normalize({ tables: [table] }, 'pdf')
  const idx = buildEvidenceIndex([
    { fileName: 'Northpark GL.pdf', status: 'ok', classification: { type: 'General Ledger (GL)' }, normalized }
  ])
  const cites = matchAccount('Rental Income', idx)
  assert.equal(cites.length, 1)
  assert.equal(cites[0].confidence, 0.9)
  assert.equal(cites[0].matchMethod, 'exact_name')
})

test('BUG 1: the position-aware path also drops the entity prefix', () => {
  // Build position-aware cells for a two-code heading then a dated transaction.
  const item = (str, x, eol = false) => ({ str, transform: [1, 0, 0, 1, x, 0], hasEOL: eol })
  const items = [
    // header
    item('Date', 40), item('Reference', 120), item('Description', 200), item('Debit', 400), item('Credit', 470, true),
    // multi-entity heading: site 715142 + account code 51051 + name
    item('715142', 10), item('51051', 60), item('Security', 120), item('Contract', 180, true),
    // a transaction under it
    item('01/20/2026', 40), item('CHK1200', 120), item('SecureGuard LLC', 200), item('4000.00', 400, true)
  ]
  const lineCells = groupItemsIntoLineCells(items)
  const table = reconstructTable([], { lineCells, classificationType: 'General Ledger (GL)' })
  assert.ok(table, 'position path reconstructs a table')
  assert.equal(table.rows[1][0], '51051 Security Contract')
  assert.equal(accountCode(table.rows[1][0]), '51051')
})

// --- BUG 2: garbled income statement → OCR detection + extraction ----------

// Substantial body of mojibake (glyph-substituted text) with almost no figures —
// the signature of a non-standard font/encoding that didn't decode.
function garbledIsLines() {
  const lines = []
  for (let i = 0; i < 12; i++) lines.push('Lqfrph Vwdwhphqw Dffrxqw Dfwxdo Exgjhw Yduldqfh Wrwdo Uhyhqxh')
  return lines
}

test('BUG 2: garbled text (no figures) is detected as unusable', () => {
  assert.equal(looksGarbledText(garbledIsLines()), true)
})

test('BUG 2: a real, figure-dense income statement is NOT flagged garbled', () => {
  const real = [
    'Account Actual Budget Variance',
    'Rental Income 120000 110000 10000',
    'Repairs 5000 4000 1000',
    'Utilities 3000 2500 500',
    'Insurance 2000 1800 200',
    'Real Estate Taxes 9000 8500 500',
    'Cleaning 4000 3500 500',
    'Security 7000 6000 1000',
    'Admin 1500 1200 300',
    'Management Fee 2200 2000 200'
  ]
  assert.equal(looksGarbledText(real), false)
  // Too little text to judge is conservatively NOT garbled (that's the scanned case).
  assert.equal(looksGarbledText(['just a couple words']), false)
  assert.equal(looksGarbledText([]), false)
})

test('BUG 2: the garbled flag routes only the base report (predicates)', () => {
  const garbled = { extracted: { metadata: { garbled: true } } }
  const scanned = { extracted: { metadata: { scanned: true } } }
  const clean = { extracted: { metadata: {} } }
  assert.equal(isGarbledPdf(garbled), true)
  assert.equal(isScannedPdf(garbled), false)
  assert.equal(isScannedPdf(scanned), true)
  assert.equal(isGarbledPdf(clean), false)
  assert.equal(isScannedPdf(clean), false)
})

test('BUG 2: OCR-recovered income-statement rows map to the variance table and compute', () => {
  const visionRows = [
    { account: '40120 Rental Income', currentActual: 120000, currentBudget: 110000, currentVariance: 10000, ytdActual: 240000, ytdBudget: 220000, ytdVariance: 20000 },
    { account: '51051 Security Contract', currentActual: 7000, currentBudget: 6000, currentVariance: 1000, ytdActual: 14000, ytdBudget: 12000, ytdVariance: 2000 }
  ]
  const table = rowsToTable(visionRows)
  assert.ok(table)
  assert.equal(table.columnCount, TABLE_COLUMNS.length)
  assert.deepEqual(table.rows[0], TABLE_COLUMNS.slice())
  // Variance % is derived from the figures (10000 / 110000 ≈ 9.1%). Column order:
  // [Account, CurrentActual, CurrentBudget, CurrentVariance, CurrentVariance %, ...].
  assert.equal(table.rows[1][4], '9.1%')

  const { normalized } = normalize({ tables: [table] }, 'pdf')
  const variance = computeVariance({ status: 'ok', normalized, classification: { type: 'Base Variance Report' } })
  assert.notEqual(variance.reason, 'not-tabular', 'the OCR-recovered table is no longer rejected')
  assert.ok(variance.comparisons.length >= 1, 'variance is computed from the recovered rows')
})

test('BUG 2: rowsToTable drops empty rows and returns null when nothing usable', () => {
  assert.equal(rowsToTable([{ account: '', currentActual: 5 }]), null)
  assert.equal(rowsToTable([{ account: 'X' }]), null) // no figures at all
  assert.equal(rowsToTable([]), null)
})

test('BUG 2: server parses income-statement rows and builds the IS prompt', () => {
  const out = parseOcrRows('```json\n{"rows":[{"account":"40120 Rental Income","currentActual":1000,"currentBudget":900}]}\n```')
  assert.equal(out.length, 1)
  assert.equal(out[0].account, '40120 Rental Income')
  assert.equal(out[0].currentActual, 1000)
  assert.deepEqual(parseOcrRows('not json'), [])

  const content = buildOcrContent(['data:image/png;base64,AAAA'], 'incomeStatement')
  const prompt = content[content.length - 1].text
  assert.match(prompt, /income statement/i)
  // Default mode is still the General Ledger prompt (no regression).
  assert.match(buildOcrContent([], 'gl')[0].text, /General Ledger/i)
})
