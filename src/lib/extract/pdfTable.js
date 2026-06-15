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
// Target pattern (per the real-world example): a Comparative Income Statement
// where each account row carries eight value cells —
//   Current: Actual, Budget, Variance, Variance %
//   YTD:     Actual, Budget, Variance, Variance %
// preceded by the account label.

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

// Among the eight value cells, these (0-based) are percentages: Current
// Variance % and YTD Variance %. Everything else is a dollar amount.
const PERCENT_CELLS = new Set([3, 7])

// Bound how many data rows we reconstruct so a large document can't spike
// memory. Not a storage limit — nothing is ever stored.
const MAX_TABLE_ROWS = 500

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

// Header / metadata signatures used only to decide whether a PDF *looks like* a
// variance report. Detection never changes how a row is parsed.
const HEADER_HINTS = [
  /\bactual\b/i,
  /\bbudget\b/i,
  /\bvariance\b/i,
  /year[\s-]*to[\s-]*date|\bytd\b/i
]

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

// True when the text body carries the signatures of a variance report header.
export function detectVarianceReport(lines = []) {
  const blob = lines.join(' \n ')
  return HEADER_HINTS.every((re) => re.test(blob))
}

// Reconstruct a variance table from grouped PDF text lines.
//
// Returns null when no usable table is found, otherwise a single table object
// matching the spreadsheet parser's shape so the normalizer can treat it the
// same way:
//   { name, rows: [headerRow, ...dataRows], columnCount, sections }
// `sections` preserves non-data heading lines as metadata only.
export function reconstructTable(lines = []) {
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
