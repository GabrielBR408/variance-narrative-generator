// --- Garbled / non-standard-encoded income-statement PDFs (Phase A) --------
// A comparative income statement PDF whose embedded font has no usable ToUnicode
// map (or a non-standard custom encoding) extracts a NON-EMPTY but unreadable
// text layer — Private Use Area / replacement / control glyphs. Nothing tabular
// parses from it, so the report used to dead-end at "no table was found".
//
// The fix detects that unreadable text layer (looksGarbledText) and flags the
// file `scanned` in pdf.js, so it routes to the OCR path exactly like an
// image-only scan. The OCR vision result for a comparative income statement is
// mapped (incomeStatementToTable) into the SAME variance table the deterministic
// reconstructor emits, so normalize → variance read it unchanged.
//
// These tests cover the DETERMINISTIC pieces: the detector, the vision→table
// mapper, the server prompt/parser, the scanned-routing flag, and the full
// table→normalize→variance path. The live vision call (feature-flagged off,
// network) is not unit-tested here, mirroring the existing OCR suite.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { looksGarbledText, GARBLE_MIN_CHARS } from '../src/lib/extract/garbled.js'
import { incomeStatementToTable, toCellString } from '../src/lib/ocr/ocrIncomeStatement.js'
import { isScannedPdf, augmentWithOcr } from '../src/lib/ocr/augment.js'
import { buildOcrContent, parseIncomeStatementResponse } from '../server/ocr.js'
import { TABLE_COLUMNS } from '../src/lib/extract/pdfTable.js'
import { normalize } from '../src/lib/extract/normalize.js'
import { computeVariance } from '../src/lib/variance/index.js'

// A clean comparative income statement text layer (what pdf.js returns for a
// well-formed PDF).
const CLEAN_IS = [
  'Comparative Income Statement Current Period Year-To-Date',
  'Account Actual Budget Variance Var% YTD Actual YTD Budget YTD Variance YTD Var%',
  'Rental Inc. - Commercial 29,522.70 37,397.50 (7,874.80) -21.06% 295,227.00 373,975.00 (78,748.00) -21.06%',
  'Utility-Elect-Building 614.81 530.00 (84.81) -16.00% 5,896.96 5,420.00 (476.96) -8.80%'
]

// Build a run of `n` Private Use Area glyphs — the classic ToUnicode-less garble.
const pua = (n) => Array.from({ length: n }, (_, i) => String.fromCodePoint(0xe000 + (i % 200))).join('')

// --- detection -------------------------------------------------------------

test('looksGarbledText: a clean income statement is NOT flagged', () => {
  assert.equal(looksGarbledText(CLEAN_IS), false)
  // A number-heavy page (mostly digits/punctuation) is still readable.
  assert.equal(looksGarbledText(['1,234.56 (789.00) 2,345.67 -12.5% 9,000.00 8,100.00']), false)
})

test('looksGarbledText: a Private-Use / replacement / control text layer IS flagged', () => {
  assert.equal(looksGarbledText([pua(80), pua(120) + ' ' + pua(40)]), true)
  // Replacement characters (U+FFFD) dominate.
  assert.equal(looksGarbledText(['�'.repeat(60) + ' 12 34']), true)
  // Control codes dominate.
  assert.equal(looksGarbledText([Array.from({ length: 60 }, () => '').join('')]), true)
})

test('looksGarbledText abstains on empty / tiny input (the scanned check owns it)', () => {
  assert.equal(looksGarbledText([]), false)
  assert.equal(looksGarbledText(['']), false)
  assert.equal(looksGarbledText('short'), false) // below GARBLE_MIN_CHARS
  assert.ok(GARBLE_MIN_CHARS >= 1)
})

test('looksGarbledText does not over-flag clean text with a few stray symbols', () => {
  // A handful of odd glyphs among plenty of readable text stays under threshold.
  const mostlyClean = 'Rental Income 29,522.70 Budget 37,397.50 Variance (7,874.80) ' + pua(3)
  assert.equal(looksGarbledText([mostlyClean]), false)
})

// --- vision JSON → variance table ------------------------------------------

test('toCellString normalizes numbers, formatted strings, parens, percents, junk', () => {
  assert.equal(toCellString(29522.7), '29522.7')
  assert.equal(toCellString('$37,397.50'), '37397.50')
  assert.equal(toCellString('(7,874.80)'), '-7874.80') // accounting negative
  assert.equal(toCellString(-21.06, true), '-21.06%') // percent cell
  assert.equal(toCellString('-21.06', true), '-21.06%')
  assert.equal(toCellString('', false), '')
  assert.equal(toCellString('n/a'), '')
  assert.equal(toCellString(Infinity), '')
})

const VISION_ROWS = [
  { account: 'Rental Inc. - Commercial', currentActual: 29522.7, currentBudget: 37397.5, currentVariance: -7874.8, currentVariancePercent: -21.06, ytdActual: 295227, ytdBudget: 373975, ytdVariance: -78748, ytdVariancePercent: -21.06 },
  { account: 'Utility-Elect-Building', currentActual: '614.81', currentBudget: '530.00', currentVariance: '(84.81)', currentVariancePercent: '-16.00', ytdActual: '5,896.96', ytdBudget: '5,420.00', ytdVariance: '(476.96)', ytdVariancePercent: '-8.80' }
]

test('incomeStatementToTable maps vision rows into the TABLE_COLUMNS variance table', () => {
  const table = incomeStatementToTable(VISION_ROWS)
  assert.equal(table.name, 'OCR Income Statement')
  assert.deepEqual(table.rows[0], TABLE_COLUMNS.slice())
  assert.deepEqual(table.rows[1], ['Rental Inc. - Commercial', '29522.7', '37397.5', '-7874.8', '-21.06%', '295227', '373975', '-78748', '-21.06%'])
  assert.deepEqual(table.rows[2], ['Utility-Elect-Building', '614.81', '530.00', '-84.81', '-16.00%', '5896.96', '5420.00', '-476.96', '-8.80%'])
})

test('incomeStatementToTable drops non-account / value-less rows and returns null when empty', () => {
  const table = incomeStatementToTable([
    { account: 'Section Header With No Numbers' }, // no value cells
    { account: '', currentActual: 100, currentBudget: 90 }, // no account label
    { account: 'Only One Number', currentActual: 100 } // fewer than two value cells
  ])
  assert.equal(table, null)
})

// --- full path: OCR table → normalize → variance ---------------------------

test('the mapped table parses through normalize + variance (no "not-tabular")', () => {
  const table = incomeStatementToTable(VISION_ROWS)
  const { normalized } = normalize({ tables: [table] }, 'pdf')
  assert.deepEqual(normalized.columns, TABLE_COLUMNS.slice())

  const result = computeVariance({
    fileId: 'base',
    fileName: 'Income Statement.pdf',
    classification: { type: 'Base Variance Report' },
    status: 'ok',
    normalized,
    confidence: 75
  })
  assert.equal(result.reason, undefined, 'parses — no not-tabular / no-comparable-columns')
  assert.ok(result.comparisonSets.length >= 1)
  const current = result.comparisonSets.find((s) => s.period === 'current')
  const rental = current.comparisons.find((c) => c.account === 'Rental Inc. - Commercial')
  assert.equal(rental.actual, 29522.7)
  assert.equal(rental.budget, 37397.5)
})

// --- server prompt + parser ------------------------------------------------

test('buildOcrContent selects the income-statement prompt for kind incomeStatement', () => {
  const is = buildOcrContent(['data:image/png;base64,AAAA'], 'incomeStatement')
  const isText = is.filter((b) => b.type === 'text')[0].text
  assert.match(isText, /income statement/i)
  // Default (and explicit 'gl') stays the General Ledger prompt — unchanged.
  const gl = buildOcrContent(['data:image/png;base64,AAAA'])
  assert.match(gl.filter((b) => b.type === 'text')[0].text, /General Ledger/i)
})

test('parseIncomeStatementResponse reads plain / fenced / prose JSON and sanitizes', () => {
  const obj = '{"rows":[{"account":"Rental Income","currentActual":29522.7,"currentBudget":37397.5}]}'
  assert.equal(parseIncomeStatementResponse(obj)[0].account, 'Rental Income')
  assert.equal(parseIncomeStatementResponse('```json\n' + obj + '\n```')[0].currentActual, 29522.7)
  assert.equal(parseIncomeStatementResponse('Here:\n' + obj + '\nThanks')[0].currentBudget, 37397.5)
  // Junk / empty → []; a row with no account is dropped.
  assert.deepEqual(parseIncomeStatementResponse('not json'), [])
  assert.deepEqual(parseIncomeStatementResponse(''), [])
  assert.equal(parseIncomeStatementResponse('{"rows":[{"account":""},{"account":"X","currentActual":5}]}').length, 1)
})

// --- routing flag ----------------------------------------------------------

test('a garbled-flagged extraction is detected as scanned (routes to OCR)', () => {
  const garbled = {
    fileName: 'Income Statement.pdf',
    status: 'empty',
    extracted: { text: [pua(200)], tables: [], metadata: { pages: 2, scanned: true, garbled: true } }
  }
  assert.equal(isScannedPdf(garbled), true)
})

test('augmentWithOcr leaves a cleanly-parsed file untouched (same reference)', async () => {
  // Not scanned/garbled → no OCR attempted, returned by identity. Guards the
  // "do not change behavior for files that already parse correctly" invariant.
  const clean = {
    fileName: 'Income Statement.pdf',
    status: 'ok',
    extracted: { text: CLEAN_IS, tables: [{ rows: [TABLE_COLUMNS.slice()] }], metadata: { pages: 1, scanned: false, garbled: false } }
  }
  const out = await augmentWithOcr(clean, { name: 'Income Statement.pdf' }, { role: 'baseReport' })
  assert.equal(out, clean)
})
