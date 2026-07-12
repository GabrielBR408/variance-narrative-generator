// --- PDF table reconstruction — Phase 7.1 ---------------------------------
// Real variance-report PDFs (e.g. a Comparative Income Statement) extract as
// readable text but NOT as a structured grid: pdf.js gives us a stream of text
// items per page, which the parser groups into visual lines. Phase 8 can't
// calculate variances from free text — it needs normalized rows + columns.
//
// This module rebuilds table-like rows from those text lines using DETERMINISTIC
// regex parsing only. The same input always yields the same rows.
//
// Boundaries: NO OCR, NO AI/ML, NO export, NO persistence, NO narratives. It
// reads lines and emits a normalized table shape. Nothing here interprets the
// numbers — that is Phase 8's job.
//
// Structure: this file owns the VARIANCE reconstructor and the reconstructTable
// DISPATCHER. The General Ledger reconstructors live in the sibling pdfGL.js, and
// the shared line-grouping / report-detection primitives in pdfShared.js. Both
// are re-exported below, so every existing `import ... from './pdfTable.js'`
// keeps working unchanged.
//
// Target pattern (per the real-world example): a Comparative Income Statement
// where each account row carries eight value cells —
//   Current: Actual, Budget, Variance, Variance %
//   YTD:     Actual, Budget, Variance, Variance %
// preceded by the account label.

import { detectVarianceReport, MAX_TABLE_ROWS } from './pdfShared.js'
import { monthIndexOf, MIN_MONTH_COLS } from './fileType.js'
import {
  looksLikeGL,
  looksLikeSectionedGLText,
  reconstructGLTable,
  reconstructSectionedGLFromText
} from './pdfGL.js'

// The fixed normalized header. Phase 8's column detection keys off these names
// ("Actual" / "Budget"), and the account column is named explicitly so it is
// never mistaken for a value column.
export const TABLE_COLUMNS = Object.freeze([
  'Account',
  'Current Actual',
  'Current Budget',
  'Current Variance',
  'Current Variance %',
  'YTD Actual',
  'YTD Budget',
  'YTD Variance',
  'YTD Variance %'
])

// Number of value cells that follow the account label on a data row.
const VALUE_COUNT = 8

// Which value cells are percentages is DERIVED from the header names above
// rather than hard-coded, so the cell mapping can never drift out of step with
// TABLE_COLUMNS. (0-based among the eight value cells; here: Current Variance %
// and YTD Variance %.)
const PERCENT_CELLS = new Set(
  TABLE_COLUMNS.slice(1)
    .map((name, i) => (/%/.test(name) ? i : -1))
    .filter((i) => i >= 0)
)

// A single numeric cell as it appears in a report: optional currency sign,
// optional leading minus (ASCII or the typographic U+2212 some PDF fonts emit),
// digits with optional thousands separators, optional decimals, and a percent
// sign / accounting-style parentheses for negatives — in either order, e.g.
// 29,522.70  (7,874.80)  -21.06%  $1,000  (21.06)%  (4.19)%.
const NUM = String.raw`\(?[-−]?\$?\d[\d,]*(?:\.\d+)?%?\)?%?`

// A data row: an account label followed by exactly eight numeric cells. Matched
// globally (not anchored) and lazily, so a single line carrying several
// concatenated rows — a PDF with no end-of-line markers — yields one match per
// row with a clean, nearest label rather than one giant row. On the normal
// (one-row-per-line) path it simply matches once. The label must contain a
// letter so a run of figures alone (a totals line) can't masquerade as a row.
// The trailing lookahead forbids a 9th numeric token after the run, so the
// values are exactly the LAST eight numeric cells before the row's end (or the
// next row's label): a label ending in a numeric token ("Salaries 5100") keeps
// that token in the label instead of donating it as the first value cell and
// shifting every cell right.
// Build a data-row regex for a given number of trailing value cells. The label
// (group 1) is followed by exactly `valueCount` numeric cells (groups 2..N+1),
// with the trailing lookahead forbidding one MORE numeric token so the values
// are the LAST run before the row's end. Shared by the comparative (8-cell) and
// the single-period (3-cell) layouts so the two can never drift.
function buildRowRe(valueCount) {
  return new RegExp(
    String.raw`(\S(?:.*?\S)?)\s+(` +
      Array(valueCount).fill(NUM).join(String.raw`)\s+(`) +
      String.raw`)(?=\s|$)(?!\s+(?:` +
      NUM +
      String.raw`)(?=\s|$))`,
    'g'
  )
}

const ROW_RE = buildRowRe(VALUE_COUNT)

// --- Single-period layout (Fix VNG: single-period income statement) --------
// A common single-period PDF lays out one Actual/Budget/Variance block only —
// no YTD — so each account row carries exactly THREE numeric cells. The 8-cell
// ROW_RE above never matches it, so the file used to parse to no table at all.
// These mirror the comparative shape with a 3-cell run and a variance-only
// (non-percent) cell set, and feed the same rowFromMatch/collectRows path.
export const SINGLE_PERIOD_COLUMNS = Object.freeze([
  'Account',
  'Actual',
  'Budget',
  'Variance'
])
const SINGLE_VALUE_COUNT = 3
// None of the three single-period cells is a percentage (Variance is a dollar
// amount here), so the percent-cell set is empty.
const SINGLE_PERCENT_CELLS = new Set()
const SINGLE_ROW_RE = buildRowRe(SINGLE_VALUE_COUNT)

// Lines we treat as report/page chrome rather than data or section headings.
const NOISE_RE =
  /^(page\s+\d+|printed|run\s*date|as\s+of\b|for\s+the\b|period\s+end|confidential|unaudited|prepared\b|company\b|date:|time:)/i

function looksLikeNumber(token) {
  return new RegExp(`^${NUM}$`).test(token)
}

// Normalize one cell token into a plain string value.
//   - amounts:  commas / currency / spaces stripped, parentheses → leading '-'.
//   - percents: same, with a single trailing '%' preserved.
// Returns null when the token carries no digits.
function cleanCell(token, isPercent) {
  const s = String(token).trim()
  // Accounting negatives use parentheses (in either order vs. a trailing %),
  // and some reports use a leading minus — ASCII or U+2212 — instead.
  const negative = s.includes('(') || s.includes('-') || s.includes('−')

  // Keep digits and decimal points only.
  const digits = s.replace(/[^0-9.]/g, '')
  if (digits === '' || digits === '.') return null

  const value = (negative ? '-' : '') + digits
  return isPercent ? `${value}%` : value
}

// Parse one cell group from a regex match into [account, ...values], or null
// when the label isn't a real account name. `valueCount` and `percentCells`
// select the layout (8-cell comparative or 3-cell single-period).
function rowFromMatch(m, valueCount, percentCells) {
  const account = m[1].trim()
  // A real account row has a name: reject labels that are purely numeric (a
  // totals line / stray figure) or carry no letter at all.
  if (account === '' || looksLikeNumber(account) || !/[A-Za-z]/.test(account)) return null

  const cells = []
  for (let i = 0; i < valueCount; i++) {
    const value = cleanCell(m[i + 2], percentCells.has(i))
    if (value === null) return null
    cells.push(value)
  }
  return [account, ...cells]
}

// Parse every data row found in a single line, for a given layout. Usually one;
// more only when a line concatenates several rows (no end-of-line markers).
function parseRowsWith(line, re, valueCount, percentCells) {
  const rows = []
  re.lastIndex = 0
  let m
  while ((m = re.exec(line)) !== null) {
    const row = rowFromMatch(m, valueCount, percentCells)
    if (row) rows.push(row)
    if (m.index === re.lastIndex) re.lastIndex++ // guard against zero-width
  }
  return rows
}

// Comparative (9-column) row parser — byte-for-byte the original behavior.
function parseRows(line) {
  return parseRowsWith(line, ROW_RE, VALUE_COUNT, PERCENT_CELLS)
}

// Single-period (Account | Actual | Budget | Variance) row parser.
function parseSinglePeriodRows(line) {
  return parseRowsWith(line, SINGLE_ROW_RE, SINGLE_VALUE_COUNT, SINGLE_PERCENT_CELLS)
}

// True when the text carries a single-period (non-comparative) report header:
// Actual, Budget, and Variance are present but there is NO year-to-date band.
// The absence of YTD cleanly separates this from a comparative statement (which
// detectVarianceReport requires all four hints for), so the two layouts are
// mutually exclusive and a genuine comparative report never routes here.
export function detectSinglePeriodReport(lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) return false
  const blob = lines.join(' \n ')
  if (/year[\s-]*to[\s-]*date|\bytd\b/i.test(blob)) return false
  return /\bactual\b/i.test(blob) && /\bbudget\b/i.test(blob) && /\bvariance\b/i.test(blob)
}

// True when a substantial body of extracted text carries almost no numeric
// figures — the signature of a financial statement whose non-standard font /
// character encoding decoded to garbled glyphs (pdf.js returns text, but the
// figures did not survive, so no table can be reconstructed). A genuine
// comparative income statement is dense with actual/budget/variance figures, so
// near-zero numeric density over enough text means the text layer is unusable
// and the page must be read via the image (OCR) path instead.
//
// Conservative by design: requires a meaningful amount of text (a near-empty
// extraction is the separate "scanned" case) so ordinary prose isn't misjudged.
// The caller only consults this when NO table could be reconstructed.
export function looksGarbledText(lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) return false
  const joined = lines.join(' ')
  const words = joined.split(/\s+/).filter(Boolean)
  if (words.length < 10) return false
  // Control characters (outside tab/newline) never appear in real income
  // statement text — their presence means the font encoding is broken and
  // the text layer is unusable. Detect before the numeric-density check.
  const controlChars = (joined.match(/[\x00-\x08\x0E-\x1F]/g) || []).length
  if (controlChars > 5) return true
  // Secondary check: require clean accounting-number tokens (e.g. 1,234.56
  // or (230,602.00)). Single-digit tokens from garbled encodings can pass a
  // naive digit check — this requires proper multi-character figure tokens.
  const cleanNumeric = words.filter((w) => /^-?\(?\d[\d,]*\.?\d*\)?$/.test(w)).length
  return cleanNumeric / words.length < 0.02
}

// Reconstruct a table from grouped PDF text lines.
//
// Dispatcher (Phase 18A): a General Ledger is reconstructed into typed
// transaction rows when the classification or content says so AND position-aware
// line cells are available; everything else uses the original variance
// reconstructor. The variance path is byte-for-byte unchanged — it is selected
// whenever the GL path is not, and the GL path never runs without `lineCells`,
// so existing callers (and tests) that pass only string lines are unaffected.
//
// Returns null when no usable table is found, otherwise a single table object
// matching the spreadsheet parser's shape so the normalizer can treat it the
// same way:
//   { name, rows: [headerRow, ...dataRows], columnCount, sections }
export function reconstructTable(lines = [], options = {}) {
  const { lineCells = null, classificationType = '' } = options || {}
  const glByClass = /general\s*ledger|\bgl\b/i.test(String(classificationType))
  const glByContent = looksLikeGL(lines) || looksLikeSectionedGLText(lines)
  // Content classification: a confident standalone-budget signature. Used to VETO
  // a purely FILENAME-driven GL branch (a real budget exported as "GL Worksheet"),
  // and to route the file to the budget reconstructor below.
  const budgetByContent = looksLikeBudget(lines)

  // GL branch is taken when CONTENT says GL, OR when the FILENAME says GL and a
  // confident budget signature does NOT veto it. Content-detected GL always wins —
  // the budget veto can never override a genuine Debit/Credit ledger — so a real GL
  // with a budget-ish name is never misrouted. The veto requires the FULL budget
  // signature (looksLikeBudget), so a weak/partial match never diverts a GL.
  if (glByContent || (glByClass && !budgetByContent)) {
    // Position-aware reconstruction first (richest: Debit/Credit x-bands and a
    // reference/vendor/description split). It needs lineCells; without them, or
    // when it resolves no rows, fall through to the text reconstructor below.
    if (Array.isArray(lineCells) && lineCells.length > 0) {
      const gl = reconstructGLTable(lineCells)
      if (gl) return gl
    }
    // NQ-6C.4: text fallback. A sectioned (MRI-style) PDF GL whose x-positions do
    // not resolve into clean amount bands is still parsed from its x-sorted line
    // STRINGS via section markers, producing the same typed table shape. Returns
    // null when no GL section is found, so a non-GL PDF falls through cleanly.
    const glText = reconstructSectionedGLFromText(lines)
    if (glText) return glText
  }

  // Budget branch: a confident standalone budget (and NOT a content GL) is
  // reconstructed into a per-account monthly grid so Phase 2B can mine its phasing.
  // Returns null when no monthly grid resolves, falling through to the variance
  // reconstructor — so a non-budget PDF is never forced into this shape.
  if (budgetByContent && !glByContent) {
    const budget = reconstructBudgetTable(lineCells)
    if (budget) return budget
  }

  return reconstructVarianceTable(lines)
}

// Reconstruct a variance table (Comparative Income Statement) from grouped PDF
// text lines. Unchanged from Phase 7.1; see module header for the target shape.
// `sections` preserves non-data heading lines as metadata only.
function reconstructVarianceTable(lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) return null

  // 1) Comparative (9-column) layout — tried first, byte-for-byte the original
  //    behavior. When it yields a usable table it wins, so a genuine comparative
  //    statement is never re-interpreted as single-period.
  const comparative = collectDataRows(lines, parseRows)
  const looksLikeReport = detectVarianceReport(lines)
  if (comparative.dataRows.length > 0 && (looksLikeReport || comparative.dataRows.length >= 2)) {
    return {
      name: 'Reconstructed',
      rows: [TABLE_COLUMNS.slice(), ...comparative.dataRows],
      columnCount: TABLE_COLUMNS.length,
      sections: comparative.sections
    }
  }

  // 2) Single-period (Account | Actual | Budget | Variance) layout — only when
  //    the comparative pass found no usable table. Gated on a single-period
  //    header signature (Actual/Budget/Variance, no YTD) so an unrelated PDF
  //    with a stray numeric run can't produce a phantom table.
  const single = collectDataRows(lines, parseSinglePeriodRows)
  const looksLikeSingle = detectSinglePeriodReport(lines)
  if (single.dataRows.length > 0 && (looksLikeSingle || single.dataRows.length >= 2)) {
    return {
      name: 'Reconstructed',
      rows: [SINGLE_PERIOD_COLUMNS.slice(), ...single.dataRows],
      columnCount: SINGLE_PERIOD_COLUMNS.length,
      sections: single.sections
    }
  }

  return null
}

// Walk grouped text lines with a layout-specific row parser, collecting data
// rows (capped at MAX_TABLE_ROWS) and short non-numeric section headings. The
// section-heading logic is identical for both layouts, so it lives here once.
function collectDataRows(lines, parseFn) {
  const dataRows = []
  const sections = []

  for (const raw of lines) {
    const line = String(raw).replace(/\s+/g, ' ').trim()
    if (!line) continue

    const parsed = parseFn(line)
    if (parsed.length > 0) {
      for (const row of parsed) {
        if (dataRows.length < MAX_TABLE_ROWS) dataRows.push(row)
      }
      continue
    }

    // Not a data row: keep short, non-numeric lines as section headings
    // (metadata only). Skip obvious page/report chrome and long prose.
    if (NOISE_RE.test(line)) continue
    const wordCount = line.split(' ').length
    const hasDigits = /\d/.test(line)
    if (!hasDigits && wordCount > 0 && wordCount <= 6) sections.push(line)
  }

  return { dataRows, sections }
}

// --- Standalone budget reconstruction (content-aware classification) -------
// A standalone annual budget (e.g. a Kardin export) is neither a variance report
// nor a GL: each account row carries a run of monthly budget figures (Jan…Dec),
// often with extra $/RSF or annual-total columns. The variance reconstructor
// (fixed 8-cell comparative shape) and the GL reconstructor (Debit/Credit bands)
// both reject it, so without this path the file produces no table and Phase 2B
// can never mine it. This rebuilds a per-account monthly grid so the budget-context
// engine can derive QUALITATIVE phasing ("weighted toward March"). It never emits
// a figure to the owner — Phase 2B sanitizes/qualifies everything downstream.
//
// DETERMINISTIC, position-aware parsing only (the same x-band technique the GL
// reconstructor uses). NO OCR, NO AI/ML. Returns null when no monthly grid
// resolves, so the dispatcher falls through cleanly.

// Full month names for the reconstructed column labels. A full name still carries
// its abbreviation, so the shared monthIndexOf / monthCols detect these columns.
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

// Corroborating budget markers anywhere in the text. Required (with a month run)
// for the FULL, high-confidence signature that may veto a filename-driven GL.
const BUDGET_MARKER_RE = /\bbudget\b|\bforecast\b|\$\s*\/?\s*rsf|\brsf\b|proforma/i

// A single budget figure: optional currency sign / leading minus / thousands
// separators / decimals, with accounting parentheses for negatives. No percent.
const BUDGET_NUM_RE = /^\(?-?\$?\d[\d,]*(?:\.\d+)?\)?$/

// Total / section chrome that is never a budget account row.
const BUDGET_NOISE_RE = /^[\s*]*(total\b|subtotal\b|grand total\b|net (income|loss|operating)\b|noi\b)/i

// x-distance within which a numeric cell is assigned to a month column.
const BUDGET_BAND_TOLERANCE = 22

function parseBudgetNumber(token) {
  const s = String(token).trim()
  if (!BUDGET_NUM_RE.test(s)) return null
  const negative = s.includes('(') || s.startsWith('-')
  const digits = s.replace(/[^0-9.]/g, '')
  if (digits === '' || digits === '.') return null
  const n = Number(digits)
  if (!Number.isFinite(n)) return null
  return negative ? -Math.abs(n) : n
}

// Distinct month tokens on a single line string.
function monthTokenCount(line) {
  const seen = new Set()
  for (const tok of String(line).split(/\s+/)) {
    const m = monthIndexOf(tok)
    if (m >= 0) seen.add(m)
  }
  return seen.size
}

// True when the text carries the FULL standalone-budget signature: an annual
// month-run header (>= MIN_MONTH_COLS distinct months on one line) AND a budget
// marker, AND it is neither a variance report nor a GL. Conservative by design so
// it never diverts a genuine GL or comparative statement.
export function looksLikeBudget(lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) return false
  if (detectVarianceReport(lines)) return false
  if (looksLikeGL(lines) || looksLikeSectionedGLText(lines)) return false
  const hasMonthRun = lines.some((l) => monthTokenCount(l) >= MIN_MONTH_COLS)
  if (!hasMonthRun) return false
  return BUDGET_MARKER_RE.test(lines.join(' \n '))
}

// Reconstruct a per-account monthly budget grid from position-aware line cells.
// Returns { name, rows: [columns, ...dataRows], columnCount, sections } or null.
export function reconstructBudgetTable(lineCells) {
  if (!Array.isArray(lineCells) || lineCells.length === 0) return null

  // 1) Header: the line carrying the most DISTINCT month columns (a budget prints
  //    its month band once). Record each month's x-anchor.
  let headerIdx = -1
  let monthAnchors = []
  const limit = Math.min(lineCells.length, 40)
  for (let i = 0; i < limit; i++) {
    const cells = lineCells[i]
    if (!Array.isArray(cells) || cells.length === 0) continue
    const anchors = []
    const seen = new Set()
    for (const c of cells) {
      const m = monthIndexOf(c.str)
      if (m >= 0 && !seen.has(m)) {
        seen.add(m)
        anchors.push({ x: c.x, month: m })
      }
    }
    if (anchors.length > monthAnchors.length) {
      monthAnchors = anchors
      headerIdx = i
    }
  }
  if (headerIdx < 0 || monthAnchors.length < MIN_MONTH_COLS) return null
  monthAnchors.sort((a, b) => a.x - b.x)
  const firstMonthX = monthAnchors[0].x

  // 2) Columns: Account + one column per detected month, in x (calendar) order.
  const columns = ['Account', ...monthAnchors.map((a) => MONTH_FULL[a.month])]

  const dataRows = []
  for (let li = headerIdx + 1; li < lineCells.length; li++) {
    const cells = lineCells[li]
    if (!Array.isArray(cells) || cells.length === 0) continue

    // Account label: the text cells left of the first month column (a numeric or
    // currency token there is not part of the label).
    const labelCells = cells.filter(
      (c) => c.x < firstMonthX - BUDGET_BAND_TOLERANCE && /[A-Za-z]/.test(c.str) && parseBudgetNumber(c.str) === null
    )
    const label = labelCells
      .map((c) => c.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!label || !/[A-Za-z]/.test(label) || BUDGET_NOISE_RE.test(label)) continue

    // Month values: the numeric cell nearest each month anchor, within tolerance.
    let filled = 0
    const monthVals = monthAnchors.map((a) => {
      let best = null
      let bestD = Infinity
      for (const c of cells) {
        const n = parseBudgetNumber(c.str)
        if (n === null) continue
        const d = Math.abs(c.x - a.x)
        if (d < bestD) {
          bestD = d
          best = n
        }
      }
      if (best != null && bestD <= BUDGET_BAND_TOLERANCE) {
        filled++
        return String(best)
      }
      return ''
    })
    if (filled === 0) continue // a heading / non-data row carries no monthly figure

    if (dataRows.length < MAX_TABLE_ROWS) dataRows.push([label, ...monthVals])
  }

  if (dataRows.length === 0) return null
  return {
    name: 'Reconstructed Budget',
    rows: [columns, ...dataRows],
    columnCount: columns.length,
    sections: []
  }
}

// --- Re-exports ------------------------------------------------------------
// Keep the module's historical public surface intact after the pdfGL.js /
// pdfShared.js split, so existing importers (pdf.js, ocrTable.js, tests) need no
// changes.
export { groupItemsIntoLineCells, groupItemsIntoLines, detectVarianceReport } from './pdfShared.js'
export {
  GL_COLUMNS,
  looksLikeGL,
  looksLikeSectionedGLText,
  reconstructSectionedGLFromText
} from './pdfGL.js'
