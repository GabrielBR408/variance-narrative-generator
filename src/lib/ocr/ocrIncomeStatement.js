// --- OCR table mapping — vision JSON → variance table (pure) ---------------
// Maps the Claude-vision OCR result for a comparative INCOME STATEMENT (a P&L
// with Current + YTD Actual/Budget/Variance columns) into the SAME normalized
// table the deterministic PDF reconstructor emits (TABLE_COLUMNS), so a base
// report whose text layer was garbled (broken font/encoding) joins the existing
// normalize → variance → narrative pipeline with ZERO downstream changes.
//
// This is the income-statement counterpart of ocrTable.js (which maps a scanned
// General Ledger). Pure & deterministic: NO network, NO browser, NO model call —
// the page rendering and the vision call live in their own modules.

import { TABLE_COLUMNS } from '../extract/pdfTable.js'

// The value columns (everything after "Account"), and which of them are percents
// — derived from TABLE_COLUMNS so the cell mapping can never drift out of step.
const VALUE_COLUMNS = TABLE_COLUMNS.slice(1)
const PERCENT_CELL = VALUE_COLUMNS.map((name) => /%/.test(name))

// The vision field carrying each value column, in TABLE_COLUMNS order. The OCR
// prompt is instructed to return exactly these keys.
const VALUE_FIELDS = [
  'currentActual',
  'currentBudget',
  'currentVariance',
  'currentVariancePercent',
  'ytdActual',
  'ytdBudget',
  'ytdVariance',
  'ytdVariancePercent'
]

// Coerce a vision value — a number or a formatted string — into the plain string
// the variance reconstructor emits: amounts as a bare number (no separators),
// percents with a single trailing '%', accounting parentheses / leading minus as
// a leading '-'. '' when the value is not numeric (so a blank cell stays blank).
export function toCellString(value, isPercent) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    const n = Math.round(value * 100) / 100
    return isPercent ? `${n}%` : String(n)
  }
  const s = String(value).trim()
  const negative = /^\(.*\)$/.test(s) || s.includes('-')
  const digits = s.replace(/[^0-9.]/g, '')
  if (digits === '' || digits === '.') return ''
  const value0 = (negative ? '-' : '') + digits
  return isPercent ? `${value0}%` : value0
}

// Build one TABLE_COLUMNS data row from a vision row, or null when the row is not
// a usable account line (no account label, or fewer than two numeric value cells
// so there is nothing to compare).
function rowFromVision(r) {
  if (!r || typeof r !== 'object') return null
  const account = String(r.account || '')
    .replace(/\s+/g, ' ')
    .trim()
  // A real account row carries a name (a letter) — never a bare figure or code.
  if (!account || !/[A-Za-z]/.test(account)) return null

  const cells = VALUE_FIELDS.map((field, i) => toCellString(r[field], PERCENT_CELL[i]))
  const numericCells = cells.filter((c) => c !== '').length
  if (numericCells < 2) return null

  return [account, ...cells]
}

// Flatten the vision income-statement payload — [{ account, currentActual, … }]
// — into a TABLE_COLUMNS table { name, rows: [header, ...data], columnCount },
// or null when no usable row survives so the caller can fall back silently.
export function incomeStatementToTable(rows = []) {
  const data = []
  for (const r of Array.isArray(rows) ? rows : []) {
    const row = rowFromVision(r)
    if (row) data.push(row)
  }
  if (data.length === 0) return null
  return {
    name: 'OCR Income Statement',
    rows: [TABLE_COLUMNS.slice(), ...data],
    columnCount: TABLE_COLUMNS.length
  }
}
