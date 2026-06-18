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

// NQ-6C.2: content-based file-type detection/flattening (sectioned GL, budget
// summary). fileType.js imports looksLikeDate from here in turn — a safe
// load-time cycle (no binding is used until runtime; the ones it needs hoist).
import {
  detectSectionedGL,
  parseSectionedGL,
  detectBudgetSummary,
  SECTIONED_GL,
  BUDGET_SUMMARY
} from './fileType.js'

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

// --- Grouped / multi-row header support (Phase 13 + 13B) -------------------
// Some statements (e.g. a Comparative Income Statement) carry a TWO-row header:
// a group/period band ("Current Period", "Year-To-Date") sitting above repeated
// value sub-headers ("Actual | Budget | Variance"). Spreadsheet exports merge
// the group cells, which SheetJS emits as the value in the top-left cell and
// blanks across the rest of the merge.
//
// Phase 13B: real exports also print several REPORT METADATA rows before the
// table (database, property, "Accrual", page/date stamps). So we cannot assume
// the header is the first row — we SCAN past the leading metadata for the first
// row that reads as a value sub-header, then fold a group band sitting directly
// above it. Everything before that block is metadata and is dropped.
//
// Detection is deliberately conservative: the value-header row must carry two or
// more value-type keywords and be non-numeric, so a flat header + numeric data,
// a PDF reconstruction, and a metadata-only sheet are all left untouched.

// Value-column keywords that mark a row as the value sub-header row.
const VALUE_HEADER_RE = /\b(actuals?|budget|forecast|planned?|prior|previous|prev|variance|act|bud)\b/i
// Group/period keywords that mark a row as the band sitting above the values.
const GROUP_HEADER_RE =
  /\b(current|ytd|year[-\s]*to[-\s]*date|y[-.\s]*t[-.\s]*d|prior|previous|month|mtd|qtd|quarter|period|this\s*year|last\s*year)\b/i

// Headers appear near the top even after metadata; bound the scan so we never
// mistake a stray text row deep in the data for a header.
const HEADER_SCAN_LIMIT = 30

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

function hasGroupKeyword(row) {
  return row.some((c) => GROUP_HEADER_RE.test(cellText(c)))
}

// The signature of a value sub-header row: non-numeric and carrying at least two
// value-type keywords (e.g. "Actual | Budget" or the doubled set under grouped
// Current/YTD periods). Two keywords keeps single-value or metadata rows out.
function isValueHeaderRow(row) {
  return isNonNumericRow(row) && countValueHeaders(row) >= 2
}

// Locate the header block, skipping any leading report-metadata rows. Returns
// { headerIdx, groupIdx } where groupIdx is the row of the group/period band
// directly above the value header (or -1 when the header is flat), or null when
// no value-header row exists (e.g. a metadata-only sheet) so the caller falls
// back to the original first-row behavior.
function findHeaderBlock(grid) {
  const limit = Math.min(grid.length, HEADER_SCAN_LIMIT)
  for (let i = 0; i < limit; i++) {
    if (!isValueHeaderRow(grid[i])) continue
    const above = i - 1
    // A group band qualifies only when it names periods/groups — never merely by
    // being blank-heavy — so a metadata row above a flat header is not folded in.
    const grouped = above >= 0 && isNonNumericRow(grid[above]) && hasGroupKeyword(grid[above])
    return { headerIdx: i, groupIdx: grouped ? above : -1 }
  }
  return null
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

// Resolve the grid into { columns, rows }: skip leading metadata to the header
// block, folding a group band into the value sub-headers when present. Falls
// back to the original first-row-as-header behavior when no value-header row is
// found, so flat/generic tables and PDF reconstructions are unchanged.
function resolveHeader(grid) {
  const block = findHeaderBlock(grid)
  if (block) {
    const { headerIdx, groupIdx } = block
    const valueRow = grid[headerIdx]
    if (groupIdx >= 0) {
      const width = Math.max(grid[groupIdx].length, valueRow.length)
      const groups = forwardFill(grid[groupIdx], width)
      const columns = []
      for (let i = 0; i < width; i++) columns.push(combineHeader(groups[i], valueRow[i]))
      return { columns, rows: grid.slice(headerIdx + 1) }
    }
    return { columns: valueRow.map((c) => String(c)), rows: grid.slice(headerIdx + 1) }
  }
  return { columns: grid[0].map((c) => String(c)), rows: grid.length > 1 ? grid.slice(1) : [] }
}

// Light type detection over the resolved data rows: which cells read as numbers
// (values) and which read as dates. Shared by the flat and sectioned-GL paths.
function collectDatesValues(rows) {
  const dates = []
  const values = []
  for (const row of rows) {
    for (const cell of row) {
      const n = toNumber(cell)
      if (n !== null) values.push(n)
      else if (looksLikeDate(cell)) dates.push(String(cell).trim())
    }
  }
  return { dates, values }
}

function normalizeSpreadsheet(extracted, kind) {
  const table = (extracted.tables && extracted.tables[0]) || { rows: [] }
  const grid = Array.isArray(table.rows) ? table.rows : []

  if (grid.length === 0) {
    return { rows: [], columns: [], accounts: [], dates: [], values: [] }
  }

  // NQ-6C.2: account-sectioned GL (e.g. a YTD GL export). The account name lives
  // on each section header, not on the transaction rows, so flatten the sections
  // into a one-transaction-per-row table the evidence index can read. Detection
  // is spreadsheet-only: a PDF reconstruction's positional columns are not this
  // grid's, and the budget-summary path below already covers the PDF worksheet.
  if (kind === 'spreadsheet' && detectSectionedGL(grid)) {
    const { columns, rows } = parseSectionedGL(grid)
    const { dates, values } = collectDatesValues(rows)
    return { rows, columns, accounts: [], dates, values, fileType: SECTIONED_GL }
  }

  // Build column labels from the header (one row, or a folded grouped band) and
  // take the remaining rows as data.
  const { columns, rows } = resolveHeader(grid)
  const { dates, values } = collectDatesValues(rows)

  // NQ-6C.2: a by-account budget/actual/variance summary carries no transaction
  // detail — tag it so the evidence index uses it for variance confirmation only
  // and never mines it for GL rows. Additive: columns/rows are left unchanged.
  const normalized = { rows, columns, accounts: [], dates, values }
  if (detectBudgetSummary(columns)) normalized.fileType = BUDGET_SUMMARY
  return normalized
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
  const normalized = grid ? normalizeSpreadsheet(extracted, kind) : normalizeText(extracted)

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
