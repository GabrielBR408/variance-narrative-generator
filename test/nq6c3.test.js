// NQ-6C.3 tests — Remove MAX_ROWS truncation for sectioned GL files
//
// The sectioned-GL parser (NQ-6C.2) runs in the normalizer, but the spreadsheet
// parser had already truncated the grid to MAX_ROWS + 1 rows before it ran — so
// account sections past row ~50 (e.g. the HVAC / Janitorial / Security contract
// accounts in a real YTD GL) were dropped and produced no GL rows.
//
// The parser now detects the sectioned shape on the COMPLETE grid and reads it
// to SECTIONED_GL_MAX_ROWS, while every other (flat) spreadsheet keeps the
// existing maxRows cap. These tests build real in-memory XLSX files to exercise
// the parser's actual truncation path.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'

import { extractSpreadsheet, SECTIONED_GL_MAX_ROWS } from '../src/lib/extract/spreadsheet.js'
import { extractFile } from '../src/lib/extract/extract.js'
import { normalize } from '../src/lib/extract/normalize.js'
import { buildEvidenceIndex, matchAccount } from '../src/lib/enrich/match.js'
import { SECTIONED_GL } from '../src/lib/extract/fileType.js'

const FLAT_CAP = 50 // the maxRows the orchestrator passes today

// --- in-memory XLSX helpers ------------------------------------------------

// Serialize an array-of-arrays grid into a minimal file-like object exposing the
// arrayBuffer()/name/size the extractor reads — a real XLSX through SheetJS.
function xlsxFile(grid, name = 'YTD Gl.xlsx') {
  const ws = XLSX.utils.aoa_to_sheet(grid)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const u8 = out instanceof Uint8Array ? out : new Uint8Array(out)
  const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
  return { name, size: u8.byteLength, arrayBuffer: async () => ab }
}

function wide(cells) {
  const row = new Array(13).fill('')
  for (const [i, v] of Object.entries(cells)) row[i] = v
  return row
}
const sectionHeader = (name) => wide({ 0: '74698', 1: '01/26', 3: name, 9: 'Balance Forward', 12: '0' })
const txn = (date, ref, memo, debit) => wide({ 0: '74698', 1: '01/26', 3: date, 4: 'AP', 5: ref, 9: memo, 10: debit, 12: debit })

const CONTRACTS = ['HVAC Contract', 'Janitorial Contract', 'Security Contract']

// A sectioned GL whose contract sections deliberately fall PAST `fillerTxns`
// filler transactions, so with the old cap (51) they were never read.
function sectionedGridWithContractsPastRow(fillerTxns) {
  const grid = [
    wide({ 0: 'YTD General Ledger — Property 74698' }),
    wide({ 0: 'Entity', 1: 'Period', 3: 'Date', 4: 'Source', 5: 'Reference', 9: 'Description', 10: 'Debit', 11: 'Credit', 12: 'Balance' }),
    sectionHeader('Repairs & Maintenance')
  ]
  for (let i = 0; i < fillerTxns; i++) {
    grid.push(txn(`01/${String((i % 28) + 1).padStart(2, '0')}/2026`, `R${i}`, `Misc repair ${i}`, '100'))
  }
  grid.push(sectionHeader('HVAC Contract'), txn('01/15/2026', 'CHK1001', 'Monthly HVAC service ABC Mechanical', '3000'))
  grid.push(sectionHeader('Janitorial Contract'), txn('01/31/2026', 'CHK1100', 'Janitorial CleanCo Services', '4500'))
  grid.push(sectionHeader('Security Contract'), txn('01/20/2026', 'CHK1200', 'Security SecureGuard LLC', '4000'))
  return grid
}

// --- the bound is at least the required size -------------------------------

test('SECTIONED_GL_MAX_ROWS lifts the cap to at least 2000 rows', () => {
  assert.ok(SECTIONED_GL_MAX_ROWS >= 2000, `expected >= 2000, got ${SECTIONED_GL_MAX_ROWS}`)
})

// --- sectioned GL is read in full ------------------------------------------

test('a sectioned GL is read past the flat cap (rows beyond row 50 survive)', async () => {
  // 60 filler transactions push the three contract sections to ~rows 64-69.
  const grid = sectionedGridWithContractsPastRow(60)
  assert.ok(grid.length > FLAT_CAP + 1, 'fixture must exceed the flat cap to be meaningful')

  const extracted = await extractSpreadsheet(xlsxFile(grid), FLAT_CAP)
  // The whole file was read — not truncated to maxRows + 1.
  assert.equal(extracted.metadata.rowsRead, grid.length)
  assert.equal(extracted.metadata.truncated, false)

  const { normalized } = normalize(extracted, 'spreadsheet')
  assert.equal(normalized.fileType, SECTIONED_GL)
  const accounts = new Set(normalized.rows.map((r) => r[0]))
  for (const account of CONTRACTS) {
    assert.ok(accounts.has(account), `${account} section (past row 50) was parsed`)
  }
})

test('the beyond-row-50 contract accounts produce matchable GL citations', async () => {
  const extracted = await extractSpreadsheet(xlsxFile(sectionedGridWithContractsPastRow(60)), FLAT_CAP)
  const { normalized } = normalize(extracted, 'spreadsheet')
  const idx = buildEvidenceIndex([{ fileName: 'YTD Gl.xlsx', status: 'ok', classification: { type: 'General Ledger (GL)' }, normalized }])
  for (const account of CONTRACTS) {
    const cites = matchAccount(account, idx)
    assert.equal(cites.length, 1, `${account} has a citation`)
    assert.equal(cites[0].confidence, 0.9, `${account} matches by name`)
    assert.ok(cites[0].thick, `${account} citation is thick (carries amount/memo)`)
  }
})

test('extractFile end-to-end: a large sectioned GL yields all contract sections', async () => {
  // 80 filler transactions — comfortably past the flat cap — via the real
  // orchestrator (classification + dynamic parser load + normalize).
  const file = xlsxFile(sectionedGridWithContractsPastRow(80), 'YTD Gl.xlsx')
  const result = await extractFile({ file })
  assert.equal(result.status, 'ok')
  assert.equal(result.normalized.fileType, SECTIONED_GL)
  const accounts = new Set(result.normalized.rows.map((r) => r[0]))
  for (const account of CONTRACTS) {
    assert.ok(accounts.has(account), `${account} present end-to-end`)
  }
})

// --- flat files still respect the existing cap -----------------------------

test('a non-sectioned flat spreadsheet still respects the maxRows cap', async () => {
  const flat = [['Account', 'Amount']]
  for (let i = 0; i < 100; i++) flat.push([`Account ${i}`, String(i * 10)])

  const extracted = await extractSpreadsheet(xlsxFile(flat, 'flat-gl.xlsx'), FLAT_CAP)
  // Header + FLAT_CAP data rows = 51, and the rest is truncated as before.
  assert.equal(extracted.metadata.rowsRead, FLAT_CAP + 1)
  assert.equal(extracted.metadata.truncated, true)

  const { normalized } = normalize(extracted, 'spreadsheet')
  assert.equal(normalized.fileType, undefined, 'a flat file is not tagged sectioned')
  assert.equal(normalized.rows.length, FLAT_CAP) // 51 read − 1 header row
})

test('a small sectioned GL (within the flat cap) reads completely too', async () => {
  // Sanity: lifting the cap never drops rows for a small sectioned file either.
  const grid = sectionedGridWithContractsPastRow(3)
  const extracted = await extractSpreadsheet(xlsxFile(grid), FLAT_CAP)
  assert.equal(extracted.metadata.rowsRead, grid.length)
  const { normalized } = normalize(extracted, 'spreadsheet')
  const accounts = new Set(normalized.rows.map((r) => r[0]))
  for (const account of CONTRACTS) assert.ok(accounts.has(account))
})
