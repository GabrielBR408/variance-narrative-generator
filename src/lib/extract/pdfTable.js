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

// Which value cells are percentages is DERIVED from the header names above
// rather than hard-coded, so the cell mapping can never drift out of step with
// TABLE_COLUMNS. (0-based among the eight value cells; here: Current Variance %
// and YTD Variance %.)
const PERCENT_CELLS = new Set(
  TABLE_COLUMNS.slice(1)
    .map((name, i) => (/%/.test(name) ? i : -1))
    .filter((i) => i >= 0)
)

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

// Horizontal position of a pdf.js text item (transform[4] = x translation).
// Items without a usable transform sort to the far left so they keep their
// relative arrival order via the stable sort.
function itemX(item) {
  const t = item && item.transform
  return Array.isArray(t) && t.length >= 5 && Number.isFinite(t[4]) ? t[4] : -Infinity
}

// Group pdf.js text items into visual lines (split on the per-item end-of-line
// marker), ordering the items WITHIN each line by horizontal position before
// joining.
//
// Why order matters: pdf.js returns text items in content-stream order, which
// for a report's right-aligned numeric columns is not guaranteed to be visual
// left-to-right — two adjacent cells (e.g. Current Budget and Current Variance)
// can arrive swapped. The downstream row parser maps cells strictly by their
// position in the line, so if the line is out of order the columns are too.
// Sorting by x makes every line read left-to-right, so the parser's positional
// mapping is always correct. The sort is stable, so already-ordered lines (the
// common case) are unchanged.
//
// Returns an array of normalized line strings (whitespace collapsed, trimmed).
// Group pdf.js text items into visual lines, KEEPING each cell's horizontal
// position: returns an array of lines, each an array of { str, x } sorted
// left-to-right. This is the position-aware counterpart of groupItemsIntoLines,
// added in Phase 18A so the GL reconstructor can assign numeric cells to the
// Debit / Credit / Balance columns by their x-band (a blank debit or credit
// cell collapses the token count, so order alone is not enough).
export function groupItemsIntoLineCells(items = []) {
  const lines = []
  let current = []

  const flush = () => {
    if (current.length === 0) return
    const cells = current
      .slice()
      .sort((a, b) => itemX(a) - itemX(b))
      .map((it) => ({ str: it && typeof it.str === 'string' ? it.str : '', x: itemX(it) }))
      .filter((c) => c.str)
    if (cells.length) lines.push(cells)
    current = []
  }

  for (const item of Array.isArray(items) ? items : []) {
    const str = item && typeof item.str === 'string' ? item.str : ''
    if (str) current.push(item)
    if (item && item.hasEOL) flush()
  }
  flush()

  return lines
}

// Collapse position-aware line cells into a single normalized line string
// (whitespace collapsed, trimmed). Shared so the string and cell views always
// derive from the same grouping.
function cellsToLine(cells) {
  return cells
    .map((c) => c.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Group pdf.js text items into normalized visual line STRINGS (the shape the
// variance reconstructor and the report-signature detection consume). Derived
// from groupItemsIntoLineCells so the two views can never drift.
export function groupItemsIntoLines(items = []) {
  return groupItemsIntoLineCells(items)
    .map(cellsToLine)
    .filter(Boolean)
}

// True when the text body carries the signatures of a variance report header.
export function detectVarianceReport(lines = []) {
  const blob = lines.join(' \n ')
  return HEADER_HINTS.every((re) => re.test(blob))
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
  if ((glByClass || looksLikeGL(lines)) && Array.isArray(lineCells) && lineCells.length > 0) {
    const gl = reconstructGLTable(lineCells)
    if (gl) return gl
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

// --- General Ledger reconstruction — Phase 18A ----------------------------
// A General Ledger is NOT a variance report: its rows are transactions
// (date · reference · vendor · memo · debit · credit · balance) grouped under
// per-account section headings, and the account label lives on the heading, not
// the transaction row. Reconstructing it as typed rows lets the existing
// supporting-evidence engine (src/lib/enrich) read real GL detail (count,
// recurring vendor, and a reliable total) instead of substring-matching the raw
// page text — the root cause of the "Detailed account activity was available for
// review." fallback.
//
// DETERMINISTIC regex/position parsing only. NO OCR, NO AI/ML. It reads lines
// and emits a normalized table; it never interprets the numbers beyond a
// faithful per-row net (Debit − Credit), and only when the row maps cleanly into
// the detected columns.

// The typed columns the GL reconstructor emits. Chosen so the evidence index
// (src/lib/enrich/match.js) resolves them as intended: "Account" is the account
// column; "Reference"/"Vendor"/"Description" are detail columns (count + recurring
// vendor); exactly ONE amount column ("Amount") keeps the reliable-total path
// unambiguous. "Date" is intentionally inert (matched by none of the index's
// column regexes).
export const GL_COLUMNS = Object.freeze([
  'Account',
  'Date',
  'Reference',
  'Vendor',
  'Description',
  'Amount'
])

// A money cell as printed in a GL: optional currency sign / leading minus /
// thousands separators / decimals, with accounting parentheses for negatives.
// No percent (a GL carries none), which also keeps variance "%" cells out.
const GL_MONEY_RE = /^\(?-?\$?\d[\d,]*(?:\.\d+)?\)?$/

// A transaction date token: m/d/y, m-d-y, or ISO y-m-d.
const GL_DATE_RE = /^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})$/

// Subtotal / running-total / balance-summary lines — never transactions.
const GL_TOTAL_RE = /^(total\b|subtotal\b|beginning balance\b|ending balance\b|net (change|income|loss)\b)/i

// An account-section heading that leads with a code + separator, e.g.
// "5100 · Utility-Elect-Building" or "6000: Office Supplies". Used so a heading
// is never mistaken for a wrapped-description continuation.
const GL_CODE_HEADING_RE = /^\d[\d.\-]*\s*[·:\-]/

// Distance (in pdf.js x-units) below which a numeric token is treated as
// equidistant between two columns — i.e. its column is ambiguous, so the row
// contributes no amount.
const GL_BAND_TOLERANCE = 12

// Parse one money token into a number (parentheses or a leading minus ⇒
// negative). null when it isn't a money token.
function parseGLMoney(token) {
  const s = String(token).trim()
  if (!GL_MONEY_RE.test(s)) return null
  const negative = s.includes('(') || s.includes('-')
  const digits = s.replace(/[^0-9.]/g, '')
  if (digits === '' || digits === '.') return null
  const n = Number(digits)
  if (!Number.isFinite(n)) return null
  return negative ? -Math.abs(n) : n
}

// Format a reconstructed net amount as a plain string value (no thousands
// separators), rounding float noise to cents. '' is never produced here — the
// caller decides when an amount is omitted.
function formatGLAmount(n) {
  const rounded = Math.round(n * 100) / 100
  return String(rounded)
}

// True when a line's text carries the GL column-header signature (both a debit
// and a credit column). Used to find the header and to skip it where it repeats
// at the top of later pages.
function isGLHeaderText(text) {
  const t = String(text).toLowerCase()
  return /\bdebit\b/.test(t) && /\bcredit\b/.test(t)
}

// True when the document's text lines look like a General Ledger rather than a
// variance report. Conservative: requires debit AND credit column words and
// explicitly excludes anything that already reads as a variance report, so the
// variance path is never hijacked.
export function looksLikeGL(lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) return false
  if (detectVarianceReport(lines)) return false
  return isGLHeaderText(lines.join(' \n '))
}

// Locate the GL column header and record each column's x-band from the header
// cell positions. Returns { idx, bands } or null. Debit and Credit are required
// (their bands are what make a row's amount reliably attributable).
function findGLHeader(lineCells) {
  const limit = Math.min(lineCells.length, 40)
  for (let i = 0; i < limit; i++) {
    const cells = lineCells[i]
    if (!Array.isArray(cells) || cells.length === 0) continue
    if (!isGLHeaderText(cellsToLine(cells))) continue

    const bands = { debitX: null, creditX: null, balanceX: null, dateX: null, nameX: null, memoX: null, numX: null }
    for (const c of cells) {
      const s = c.str.toLowerCase()
      if (/debit|\bdr\b/.test(s) && bands.debitX == null) bands.debitX = c.x
      else if (/credit|\bcr\b/.test(s) && bands.creditX == null) bands.creditX = c.x
      else if (/balance/.test(s) && bands.balanceX == null) bands.balanceX = c.x
      else if (/date/.test(s) && bands.dateX == null) bands.dateX = c.x
      else if (/name|payee|vendor/.test(s) && bands.nameX == null) bands.nameX = c.x
      else if (/memo|description|desc|narrative|split/.test(s) && bands.memoX == null) bands.memoX = c.x
      else if (/num|ref|reference|type|doc|check/.test(s) && bands.numX == null) bands.numX = c.x
    }
    if (bands.debitX != null && bands.creditX != null) return { idx: i, bands }
  }
  return null
}

// Assign each money token on a row to its nearest amount band (Debit / Credit /
// Balance). Returns { debit, credit, balance } values, or null when the mapping
// is AMBIGUOUS — a token is equidistant between two bands, two tokens fall in the
// same band, or there are more tokens than bands. An ambiguous row contributes
// no amount, so totals are never guessed.
function assignAmountBands(moneyCells, anchors) {
  if (moneyCells.length > anchors.length) return null
  const result = { debit: null, credit: null, balance: null }
  const used = new Set()
  for (const cell of moneyCells) {
    let best = null
    let bestD = Infinity
    let secondD = Infinity
    for (const [name, x] of anchors) {
      const d = Math.abs(cell.x - x)
      if (d < bestD) {
        secondD = bestD
        bestD = d
        best = name
      } else if (d < secondD) {
        secondD = d
      }
    }
    if (best == null) return null
    if (secondD - bestD < GL_BAND_TOLERANCE) return null // equidistant ⇒ ambiguous
    if (used.has(best)) return null // two tokens to one band ⇒ ambiguous
    used.add(best)
    result[best] = parseGLMoney(cell.str)
  }
  return result
}

// Tidy an account-section heading for use as the row's Account label: collapse
// whitespace and drop a trailing colon.
function cleanAccountHeading(text) {
  return String(text).replace(/\s+/g, ' ').replace(/\s*:\s*$/, '').trim()
}

// Reconstruct a typed GL table from position-aware line cells. Returns null when
// no GL header (with Debit + Credit columns) is found or no transactions are
// reconstructed, so the caller can fall back cleanly.
function reconstructGLTable(lineCells) {
  if (!Array.isArray(lineCells) || lineCells.length === 0) return null
  const header = findGLHeader(lineCells)
  if (!header) return null

  const { idx, bands } = header
  const anchors = [
    ['debit', bands.debitX],
    ['credit', bands.creditX],
    ['balance', bands.balanceX]
  ].filter(([, x]) => x != null)
  // Numeric tokens left of this x are date/reference/name/memo, not money.
  const moneyStart = Math.min(...anchors.map(([, x]) => x)) - 25
  // A line starting at/near the left margin is an account-section heading; an
  // indented text-only line (under the Name/Memo columns) is a wrapped memo. The
  // left margin is the leftmost data column (Date / Num).
  const leftCandidates = [bands.dateX, bands.numX].filter((x) => x != null)
  const headingLeftEdge = (leftCandidates.length ? Math.min(...leftCandidates) : 0) + 10

  const dataRows = []
  const sections = []
  let currentAccount = ''
  let lastTxn = null // the most recent transaction row (for wrapped-memo continuation)
  let lastWasTotal = false

  for (let li = idx + 1; li < lineCells.length; li++) {
    const cells = lineCells[li]
    if (!Array.isArray(cells) || cells.length === 0) continue
    const text = cellsToLine(cells)
    if (!text) continue

    // A repeated header at the top of a later page is chrome, not data.
    if (isGLHeaderText(text)) {
      lastTxn = null
      continue
    }

    const dateCell = cells.find((c) => GL_DATE_RE.test(c.str))

    // Subtotal / running-balance lines (no date) close the current run and are
    // never counted as transactions.
    if (!dateCell && GL_TOTAL_RE.test(text)) {
      lastTxn = null
      lastWasTotal = true
      continue
    }

    const moneyCells = cells.filter((c) => c !== dateCell && c.x >= moneyStart && parseGLMoney(c.str) !== null)

    // A transaction needs an active account section and a date.
    if (currentAccount && dateCell) {
      let amount = null
      if (moneyCells.length > 0) {
        const assigned = assignAmountBands(moneyCells, anchors)
        if (assigned && (assigned.debit != null || assigned.credit != null)) {
          amount = (assigned.debit || 0) - (assigned.credit || 0)
        }
      }

      // Reference = money-like tokens left of the money region (e.g. a "Num").
      const reference = cells
        .filter((c) => c !== dateCell && c.x < moneyStart && parseGLMoney(c.str) !== null)
        .map((c) => c.str)
        .join(' ')
        .trim()

      // Vendor / Description = the remaining non-date, non-money text, split by
      // the name/memo bands when both are known; otherwise all of it is the
      // vendor (so recurring-vendor detection still works).
      const textCells = cells.filter(
        (c) => c !== dateCell && c.x < moneyStart && !GL_DATE_RE.test(c.str) && parseGLMoney(c.str) === null
      )
      let vendor = ''
      let description = ''
      if (bands.nameX != null && bands.memoX != null) {
        const mid = (bands.nameX + bands.memoX) / 2
        vendor = textCells.filter((c) => c.x <= mid).map((c) => c.str).join(' ').trim()
        description = textCells.filter((c) => c.x > mid).map((c) => c.str).join(' ').trim()
      } else {
        vendor = textCells.map((c) => c.str).join(' ').trim()
      }

      const row = [currentAccount, dateCell.str, reference, vendor, description, amount == null ? '' : formatGLAmount(amount)]
      if (dataRows.length < MAX_TABLE_ROWS) {
        dataRows.push(row)
        lastTxn = row
      }
      lastWasTotal = false
      continue
    }

    // Non-transaction text line: either a wrapped-description continuation of the
    // previous transaction, or a new account-section heading. A heading sits at
    // the left margin (or leads with an account code); a wrapped memo is indented
    // under the Name/Memo columns and only continues an open transaction.
    const hasMoney = cells.some((c) => c.x >= moneyStart && parseGLMoney(c.str) !== null)
    if (/[A-Za-z]/.test(text) && !dateCell && !hasMoney) {
      const leftX = cells[0].x // cells are sorted left-to-right
      const headingLike = leftX <= headingLeftEdge || GL_CODE_HEADING_RE.test(text)
      if (!headingLike && lastTxn && !lastWasTotal) {
        // Wrapped memo: append to the previous transaction's Description.
        lastTxn[4] = lastTxn[4] ? `${lastTxn[4]} ${text}` : text
      } else {
        currentAccount = cleanAccountHeading(text)
        sections.push(currentAccount)
        lastTxn = null
        lastWasTotal = false
      }
    }
  }

  if (dataRows.length === 0) return null
  const rows = [GL_COLUMNS.slice(), ...dataRows]
  return {
    name: 'Reconstructed GL',
    rows,
    columnCount: GL_COLUMNS.length,
    sections
  }
}
