// --- Normalizer — Phase 7 -------------------------------------------------
// Collapses each parser's raw output into ONE generic in-memory shape so later
// phases have a single contract to read from, regardless of source format:
//
//   { rows, columns, accounts, dates, values }
//
// Deliberately generic. We do light, type-level detection only — which cells
// look like numbers and which look like dates — which is "normalizing extracted
// values", not financial modeling. `accounts` is a domain concept and stays an
// empty placeholder until a later phase assigns meaning. No variance math, no
// thresholds, no interpretation happens here.

// Confidence is a coarse signal about how trustworthy the extraction is, NOT a
// statement about the file's contents.
const BASE_CONFIDENCE = {
  spreadsheet: 95, // structured grid → high
  document: 80, // clean paragraph text
  pdf: 75 // text layer can be messy / partial
}

const DATE_RE =
  /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4})$/i

export function looksLikeDate(value) {
  return DATE_RE.test(String(value).trim())
}

// Parse a cell into a number if it generically reads as one. Handles currency
// symbols, thousands separators, percents, and accounting-style negatives
// "(1,200)". Returns null when it isn't numeric. No currency/units are inferred.
export function toNumber(value) {
  const raw = String(value).trim()
  if (!raw) return null
  const negative = /^\(.*\)$/.test(raw)
  const cleaned = raw.replace(/[(),$%\s]/g, '').replace(/[^0-9.\-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return negative ? -Math.abs(n) : n
}

function normalizeSpreadsheet(extracted) {
  const table = (extracted.tables && extracted.tables[0]) || { rows: [] }
  const grid = Array.isArray(table.rows) ? table.rows : []

  if (grid.length === 0) {
    return { rows: [], columns: [], accounts: [], dates: [], values: [] }
  }

  // First row is treated as the header for column labels; the rest are data.
  const columns = grid[0].map((c) => String(c))
  const rows = grid.length > 1 ? grid.slice(1) : []

  const dates = []
  const values = []
  for (const row of rows) {
    for (const cell of row) {
      const n = toNumber(cell)
      if (n !== null) values.push(n)
      else if (looksLikeDate(cell)) dates.push(String(cell).trim())
    }
  }

  return { rows, columns, accounts: [], dates, values }
}

function normalizeText(extracted) {
  // Each text block becomes a single-cell row; columns/values/dates stay empty
  // because free text has no reliable tabular structure to type at this phase.
  const blocks = Array.isArray(extracted.text) ? extracted.text : []
  return {
    rows: blocks.map((t) => [t]),
    columns: [],
    accounts: [],
    dates: [],
    values: []
  }
}

function hasReconstructedTable(extracted) {
  const table = extracted.tables && extracted.tables[0]
  return Boolean(table && Array.isArray(table.rows) && table.rows.length > 0)
}

// Returns { normalized, confidence, empty }.
export function normalize(extracted, kind) {
  // A spreadsheet is always a grid. A PDF (Phase 7.1) becomes a grid only when
  // table reconstruction produced rows; otherwise it stays free text. DOCX is
  // always free text.
  const grid = kind === 'spreadsheet' || (kind === 'pdf' && hasReconstructedTable(extracted))
  const normalized = grid ? normalizeSpreadsheet(extracted) : normalizeText(extracted)

  // "Empty" reflects whether the parser found anything readable at all, judged
  // on the source: a grid's rows, or a text source's blocks.
  const empty = grid
    ? !((extracted.tables && extracted.tables[0] && extracted.tables[0].rows) || []).length
    : normalized.rows.length === 0

  let confidence = empty ? 0 : BASE_CONFIDENCE[kind] || 0

  // A grid with a header but no data rows is real, but thin.
  if (grid && !empty && normalized.rows.length === 0) confidence = 50

  return { normalized, confidence, empty }
}
