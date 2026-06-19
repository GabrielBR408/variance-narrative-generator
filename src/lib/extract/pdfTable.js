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
// optional leading minus, digits with optional thousands separators, optional
// decimals, and a percent sign / accounting-style parentheses for negatives —
// in either order, e.g. 29,522.70  (7,874.80)  -21.06%  $1,000  (21.06)%  (4.19)%.
const NUM = String.raw`\(?-?\$?\d[\d,]*(?:\.\d+)?%?\)?%?`

// A data row: an account label followed by exactly eight numeric cells. Matched
// globally (not anchored) and lazily, so a single line carrying several
// concatenated rows — a PDF with no end-of-line markers — yields one match per
// row with a clean, nearest label rather than one giant row. On the normal
// (one-row-per-line) path it simply matches once. The label must contain a
// letter so a run of figures alone (a totals line) can't masquerade as a row.
const ROW_RE = new RegExp(
  String.raw`(\S(?:.*?\S)?)\s+(` +
    Array(VALUE_COUNT).fill(NUM).join(String.raw`)\s+(`) +
    String.raw`)(?=\s|$)`,
  'g'
)

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
  // and some reports use a leading minus instead.
  const negative = s.includes('(') || s.includes('-')

  // Keep digits and decimal points only.
  const digits = s.replace(/[^0-9.]/g, '')
  if (digits === '' || digits === '.') return null

  const value = (negative ? '-' : '') + digits
  return isPercent ? `${value}%` : value
}

// Parse one cell group from a regex match into [account, ...8 values], or null
// when the label isn't a real account name.
function rowFromMatch(m) {
  const account = m[1].trim()
  // A real account row has a name: reject labels that are purely numeric (a
  // totals line / stray figure) or carry no letter at all.
  if (account === '' || looksLikeNumber(account) || !/[A-Za-z]/.test(account)) return null

  const cells = []
  for (let i = 0; i < VALUE_COUNT; i++) {
    const value = cleanCell(m[i + 2], PERCENT_CELLS.has(i))
    if (value === null) return null
    cells.push(value)
  }
  return [account, ...cells]
}

// Parse every data row found in a single line. Usually one; more only when a
// line concatenates several rows (no end-of-line markers).
function parseRows(line) {
  const rows = []
  ROW_RE.lastIndex = 0
  let m
  while ((m = ROW_RE.exec(line)) !== null) {
    const row = rowFromMatch(m)
    if (row) rows.push(row)
    if (m.index === ROW_RE.lastIndex) ROW_RE.lastIndex++ // guard against zero-width
  }
  return rows
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
  if (glByClass || glByContent) {
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
  return reconstructVarianceTable(lines)
}

// Reconstruct a variance table (Comparative Income Statement) from grouped PDF
// text lines. Unchanged from Phase 7.1; see module header for the target shape.
// `sections` preserves non-data heading lines as metadata only.
function reconstructVarianceTable(lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) return null

  const dataRows = []
  const sections = []

  for (const raw of lines) {
    const line = String(raw).replace(/\s+/g, ' ').trim()
    if (!line) continue

    const parsed = parseRows(line)
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

  // Require a header signature plus at least one data row, OR a strong tabular
  // signal (multiple data rows) on its own. This keeps unrelated PDFs from
  // producing a phantom table.
  const looksLikeReport = detectVarianceReport(lines)
  if (dataRows.length === 0) return null
  if (!looksLikeReport && dataRows.length < 2) return null

  const rows = [TABLE_COLUMNS.slice(), ...dataRows]
  return {
    name: 'Reconstructed',
    rows,
    columnCount: TABLE_COLUMNS.length,
    sections
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
