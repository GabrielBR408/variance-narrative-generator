// --- Spreadsheet parser — Phase 7 -----------------------------------------
// Reads XLSX / XLS / CSV via SheetJS into plain rows + columns. One code path
// covers all three formats (SheetJS sniffs the type from the bytes).
//
// Extracts the first sheet's grid as arrays of cells, capped at MAX_ROWS. No
// formulas are evaluated (formula cells yield their cached value as text), no
// styling is read, and no financial meaning is assigned — that's a later phase.

import * as XLSX from 'xlsx'

function fail(reason, message) {
  return Object.assign(new Error(message || reason), { reason })
}

export async function extractSpreadsheet(file, maxRows) {
  const data = new Uint8Array(await file.arrayBuffer())

  let book
  try {
    // cellDates keeps date cells as JS Dates (not Excel serial numbers) so the
    // normalizer can recognize them as dates rather than plain values.
    book = XLSX.read(data, { type: 'array', cellDates: true })
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
  const cap = maxRows + 1
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

function cellToText(v) {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}
