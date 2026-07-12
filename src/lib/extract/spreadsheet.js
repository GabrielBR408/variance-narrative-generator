// --- Spreadsheet parser — Phase 7 -----------------------------------------
// Reads XLSX / XLS / CSV via SheetJS into plain rows + columns. One code path
// covers all three formats (SheetJS sniffs the type from the bytes).
//
// Extracts the first sheet's grid as arrays of cells, capped at MAX_ROWS (an
// account-sectioned GL is read to a higher bound so no account section is lost —
// NQ-6C.3). No formulas are evaluated (formula cells yield their cached value as
// text), no styling is read, and no financial meaning is assigned — later phase.

import * as XLSX from 'xlsx'

import { detectSectionedGL } from './fileType.js'

// NQ-6C.3: an account-sectioned GL is read in full up to this bound instead of
// the flat-file maxRows, because its account sections — including the flagged
// contract accounts — routinely fall well past a 50-row cap, and truncating
// here would drop them before the sectioned parser ever runs. Bounded (not
// unlimited) so a pathological file still cannot exhaust memory or time.
export const SECTIONED_GL_MAX_ROWS = 5000

function fail(reason, message) {
  return Object.assign(new Error(message || reason), { reason })
}

// Binary spreadsheet signatures we must NOT try to decode as text: a ZIP local
// header ("PK\x03\x04" → xlsx/xlsm) and the OLE2 compound-file magic
// (D0 CF 11 E0 → legacy xls). SheetJS reads these from the raw bytes.
function hasBinarySignature(bytes) {
  if (!bytes || bytes.length < 4) return false
  const pk = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
  return pk || ole
}

// Decode bytes as UTF-8 iff they are WELL-FORMED UTF-8, else null. Uses the
// platform's strict decoder (fatal:true throws on any invalid sequence) — a
// standard UTF-8 validity check on the raw bytes, with no content guessing. A
// leading UTF-8 BOM is honored/stripped by the decoder.
function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

export async function extractSpreadsheet(file, maxRows) {
  const data = new Uint8Array(await file.arrayBuffer())

  // UTF-8 detection for a BOM-less text file (CSV/TSV): SheetJS has no UTF-8
  // sniffing and falls back to Windows-1252 for CSVs read as bytes, which
  // mangles any accented / currency / emoji character in an account name
  // ("CafÃ©" for "Café"). When the bytes are NOT a binary workbook AND are
  // well-formed UTF-8, decode them ourselves and hand SheetJS the string so it
  // parses the text verbatim. A genuine cp1252 CSV fails the UTF-8 check and
  // still falls through to SheetJS's default decoding, unchanged.
  let readInput = data
  let readType = 'array'
  if (!hasBinarySignature(data)) {
    const text = decodeUtf8(data)
    if (text !== null) {
      readInput = text
      readType = 'string'
    }
  }

  let book
  try {
    // cellDates keeps date cells as JS Dates (not Excel serial numbers) so the
    // normalizer can recognize them as dates rather than plain values.
    book = XLSX.read(readInput, { type: readType, cellDates: true })
  } catch {
    throw fail('corrupt')
  }

  const sheetNames = book.SheetNames || []
  if (sheetNames.length === 0) throw fail('structure')

  const firstName = sheetNames[0]
  const sheet = book.Sheets[firstName]

  // header:1 → array-of-arrays; blank cells become '' so columns stay aligned.
  let grid
  try {
    grid = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' })
  } catch {
    throw fail('structure')
  }

  const totalRows = grid.length
  // +1 so the header row is shown in addition to MAX_ROWS of data when present.
  // NQ-6C.3: detect an account-sectioned GL on the COMPLETE grid (detection reads
  // only two columns, so this is cheap even before the slice) and read it to
  // SECTIONED_GL_MAX_ROWS, so account sections past the flat cap are not dropped
  // before the sectioned parser runs. Every other spreadsheet is unchanged.
  const cap = detectSectionedGL(grid) ? Math.max(maxRows + 1, SECTIONED_GL_MAX_ROWS) : maxRows + 1
  const rows = grid.slice(0, cap).map((r) => (Array.isArray(r) ? r.map(cellToText) : [cellToText(r)]))

  // Column count is the widest row we kept (cells may be ragged).
  const columnCount = rows.reduce((max, r) => Math.max(max, r.length), 0)

  return {
    text: [],
    tables: [
      {
        name: firstName,
        rows,
        columnCount
      }
    ],
    metadata: {
      sheets: sheetNames.length,
      sheetNames,
      totalRows,
      rowsRead: rows.length,
      truncated: totalRows > rows.length
    }
  }
}

export function cellToText(v) {
  if (v === null || v === undefined) return ''
  // Format a date cell from its LOCAL components: SheetJS parses calendar dates
  // to local time, so toISOString() would shift them a day for UTC+ timezones.
  if (v instanceof Date) {
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(v)
}
