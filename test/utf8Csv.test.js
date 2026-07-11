// Fix 2 regression — UTF-8 CSV without a BOM.
//
// SheetJS has no UTF-8 sniffing for BOM-less CSVs read as bytes, so it fell back
// to Windows-1252 and mangled accented / currency / emoji characters in account
// names ("CafÃ©" for "Café"). The parser now decodes well-formed UTF-8 itself
// before handing SheetJS the text. These pin correct decoding AND prove binary
// workbooks and genuine cp1252 CSVs are unaffected.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'

import { extractSpreadsheet } from '../src/lib/extract/spreadsheet.js'
import { normalize } from '../src/lib/extract/normalize.js'
import { MAX_ROWS } from '../src/lib/extract/extract.js'

function fileFromBytes(u8, name) {
  const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
  return { name, size: u8.byteLength, arrayBuffer: async () => ab }
}

const ACCENTED_CSV =
  'Account,Actual,Budget\n' +
  'Café Revenue,100,90\n' +
  'Résumé Fees,50,40\n' +
  '€ Charges,10,8\n' +
  'Rocket 🚀 Fund,5,3\n'

// --- 1. UTF-8 (no BOM) round-trips accents, currency, and emoji -------------

test('a BOM-less UTF-8 CSV keeps accented / currency / emoji characters', async () => {
  const u8 = new TextEncoder().encode(ACCENTED_CSV)
  assert.notEqual(u8[0], 0xef, 'fixture has no BOM')

  const ex = await extractSpreadsheet(fileFromBytes(u8, 'accounts.csv'), MAX_ROWS)
  const names = ex.tables[0].rows.slice(1).map((r) => r[0])
  assert.deepEqual(names, ['Café Revenue', 'Résumé Fees', '€ Charges', 'Rocket 🚀 Fund'])
  // The mojibake the cp1252 fallback produced must NOT appear.
  assert.doesNotMatch(JSON.stringify(ex.tables[0].rows), /CafÃ©|Ã©|â‚¬/)
})

test('the corrected characters survive normalization into columns/rows', async () => {
  const u8 = new TextEncoder().encode(ACCENTED_CSV)
  const ex = await extractSpreadsheet(fileFromBytes(u8, 'accounts.csv'), MAX_ROWS)
  const { normalized } = normalize(ex, 'spreadsheet')
  assert.deepEqual(normalized.columns, ['Account', 'Actual', 'Budget'])
  assert.equal(normalized.rows[0][0], 'Café Revenue')
  assert.equal(normalized.rows[3][0], 'Rocket 🚀 Fund')
})

// --- 2. A UTF-8 BOM CSV is still fine ---------------------------------------

test('a UTF-8 CSV WITH a BOM still decodes correctly', async () => {
  const u8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Account,Actual\nCafé,5\n')])
  const ex = await extractSpreadsheet(fileFromBytes(u8, 'bom.csv'), MAX_ROWS)
  assert.equal(ex.tables[0].rows[1][0], 'Café')
})

// --- 3. A genuine cp1252 CSV is NOT misdecoded (fallback unchanged) ---------

test('a non-UTF-8 (cp1252) CSV falls through to the default decoding, no crash', async () => {
  // "Café Rev" with é as a single 0xE9 byte — invalid standalone UTF-8, so the
  // UTF-8 check fails and SheetJS's cp1252 fallback (0xE9 → é) runs, unchanged.
  const bytes = [
    ...new TextEncoder().encode('Account,Actual\nCaf'),
    0xe9,
    ...new TextEncoder().encode(' Rev,5\n')
  ]
  const ex = await extractSpreadsheet(fileFromBytes(new Uint8Array(bytes), 'legacy.csv'), MAX_ROWS)
  assert.equal(ex.tables[0].rows[0][0], 'Account')
  assert.equal(ex.tables[0].rows[1][0], 'Café Rev')
})

// --- 4. A binary XLSX workbook is unaffected --------------------------------

test('a binary XLSX (ZIP-signature) workbook is read from bytes as before', async () => {
  const ws = XLSX.utils.aoa_to_sheet([['Account', 'Actual'], ['Café', 5]])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const u8 = out instanceof Uint8Array ? out : new Uint8Array(out)
  assert.equal(u8[0], 0x50, 'xlsx starts with the ZIP "PK" signature')

  const ex = await extractSpreadsheet(fileFromBytes(u8, 'book.xlsx'), MAX_ROWS)
  assert.deepEqual(ex.tables[0].rows, [['Account', 'Actual'], ['Café', '5']])
  assert.equal(ex.metadata.sheets, 1)
})
