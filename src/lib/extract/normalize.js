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

// --- Grouped / multi-row header support -----------------------------------
// Some statements (e.g. a Comparative Income Statement) carry a TWO-row header:
// a group/period band ("Current Period", "Year-To-Date") sitting above repeated
// value sub-headers ("Actual | Budget | Variance"). Spreadsheet exports merge
// the group cells, which SheetJS emits as the value in the top-left cell and
// blanks across the rest of the merge. If we keep only the first row as the
// header, the real sub-headers fall into the data and column detection fails.
//
// These helpers detect that shape and fold the two rows into one combined
// header ("Current Period Actual", …) so the existing detection works unchanged.
// They are deliberately conservative: a flat header followed by numeric data
// never trips the detector, so simple CSV/single-row tables are untouched.

// Value-column keywords that mark a row as the value sub-header row.
const VALUE_HEADER_RE = /\b(actuals?|budget|forecast|planned?|prior|previous|prev|variance|act|bud)\b/i
// Group/period keywords that mark a row as the band sitting above the values.
const GROUP_HEADER_RE =
  /\b(current|ytd|year[-\s]*to[-\s]*date|y[-.\s]*t[-.\s]*d|prior|previous|month|mtd|qtd|quarter|period|this\s*year|last\s*year)\b/i

function cellText(c) {
  return c === null || c === undefined ? '' : String(c).trim()
}

// A header row carries labels, not figures: every non-empty cell must fail to
// parse as a number. This is what separates a sub-header row from a data row.
function isNonNumericRow(row) {
  for (const cell of row) {
    const t = cellText(cell)
    if (t !== '') if (toNumber(t) !== null) return false
  }
  return true
}

function countValueHeaders(row) {
  let n = 0
  for (const cell of row) if (VALUE_HEADER_RE.test(cellText(cell))) n++
  return n
}

function hasBlankCell(row) {
  return row.some((c) => cellText(c) === '')
}

function hasGroupKeyword(row) {
  return row.some((c) => GROUP_HEADER_RE.test(cellText(c)))
}

// True when the grid opens with a group band over a repeated value sub-header.
// Requires a data row to exist so a two-row table (header + one data row) is
// never mistaken for a header band.
function hasGroupedHeader(grid) {
  if (grid.length < 3) return false
  const [row0, row1] = grid
  const subHeaderLike = isNonNumericRow(row1) && countValueHeaders(row1) >= 2
  const groupLike = isNonNumericRow(row0) && (hasBlankCell(row0) || hasGroupKeyword(row0))
  return subHeaderLike && groupLike
}

// Carry each group label rightward across the blank cells a horizontal merge
// leaves behind, so every sub-column inherits its group ("Current Period").
function forwardFill(row, width) {
  const out = []
  let last = ''
  for (let i = 0; i < width; i++) {
    const t = cellText(row[i])
    if (t !== '') last = t
    out.push(last)
  }
  return out
}

// Join a group label and its sub-header into one column name. Either half may be
// absent (e.g. the account column has no group above it).
function combineHeader(group, sub) {
  const g = cellText(group)
  const s = cellText(sub)
  if (g && s && g !== s) return `${g} ${s}`
  return s || g
}

// Resolve the grid into { columns, rows }: a combined two-row header when a
// grouped band is detected, otherwise the first row as a flat header.
function resolveHeader(grid) {
  if (hasGroupedHeader(grid)) {
    const width = Math.max(grid[0].length, grid[1].length)
    const groups = forwardFill(grid[0], width)
    const subs = grid[1]
    const columns = []
    for (let i = 0; i < width; i++) columns.push(combineHeader(groups[i], subs[i]))
    return { columns, rows: grid.slice(2) }
  }
  return { columns: grid[0].map((c) => String(c)), rows: grid.length > 1 ? grid.slice(1) : [] }
}

function normalizeSpreadsheet(extracted) {
  const table = (extracted.tables && extracted.tables[0]) || { rows: [] }
  const grid = Array.isArray(table.rows) ? table.rows : []

  if (grid.length === 0) {
    return { rows: [], columns: [], accounts: [], dates: [], values: [] }
  }

  // Build column labels from the header (one row, or a folded grouped band) and
  // take the remaining rows as data.
  const { columns, rows } = resolveHeader(grid)

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
