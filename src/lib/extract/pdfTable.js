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

// Subtotal / running-total / balance-summary lines — never transactions. Leading
// non-alphanumerics (e.g. MRI's "** Account Totals") are tolerated.
const GL_TOTAL_RE = /^[\s*]*(total\b|subtotal\b|account totals\b|beginning balance\b|ending balance\b|net (change|income|loss)\b|grand total\b)/i

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

// Locate the GL column header and record each column's x-band. Returns
// { idx, bands } or null. Debit and Credit are required.
//
// Real ledgers (e.g. MRI Software) print a STACKED header spread across several
// lines interleaved with report metadata: Debit/Credit on one line, Balance on
// another, Date/Reference/Description elsewhere. So we anchor on the line that
// carries both Debit and Credit, then collect the remaining column bands from
// the whole header region (everything before the first transaction line), with
// position guards so report chrome like "Date:" / "Page:" in the right margin is
// never mistaken for the Date column.
function detectGLBands(lineCells) {
  const limit = Math.min(lineCells.length, 40)

  // 1) Anchor: the first line carrying both a Debit and a Credit column label.
  let anchorIdx = -1
  let debitX = null
  let creditX = null
  for (let i = 0; i < limit; i++) {
    const cells = lineCells[i]
    if (!Array.isArray(cells) || cells.length === 0) continue
    if (!isGLHeaderText(cellsToLine(cells))) continue
    debitX = creditX = null
    for (const c of cells) {
      const s = c.str.toLowerCase()
      if (/debit|\bdr\b/.test(s) && debitX == null) debitX = c.x
      else if (/credit|\bcr\b/.test(s) && creditX == null) creditX = c.x
    }
    if (debitX != null && creditX != null) {
      anchorIdx = i
      break
    }
  }
  if (anchorIdx < 0) return null

  // 2) First transaction line — a dated row with a money cell in the value
  //    region — bounds the header region we scan for labels.
  const moneyMin = Math.min(debitX, creditX) - 30
  let firstTxn = lineCells.length
  for (let i = anchorIdx + 1; i < Math.min(lineCells.length, anchorIdx + 60); i++) {
    const cells = lineCells[i]
    if (!Array.isArray(cells) || cells.length === 0) continue
    const dated = cells.some((c) => GL_DATE_RE.test(c.str))
    const valued = cells.some((c) => c.x >= moneyMin && parseGLMoney(c.str) !== null)
    if (dated && valued) {
      firstTxn = i
      break
    }
  }

  // 3) Collect column bands from the header region. Text-column labels must sit
  //    left of the Debit column; Balance must sit right of Credit. Exact-word
  //    tests avoid matching data ("Balance Forward") or chrome ("Database:").
  const bands = { debitX, creditX, balanceX: null, dateX: null, refX: null, nameX: null, descX: null, entityX: null, periodX: null }
  const regionEnd = Math.min(firstTxn, anchorIdx + 20)
  for (let i = 0; i < regionEnd; i++) {
    const cells = lineCells[i]
    if (!Array.isArray(cells) || cells.length === 0) continue
    for (const c of cells) {
      const s = c.str.toLowerCase().trim()
      if (/^balance$/.test(s) && c.x > creditX && bands.balanceX == null) bands.balanceX = c.x
      if (c.x < debitX) {
        if (/^date$/.test(s) && bands.dateX == null) bands.dateX = c.x
        else if (/reference|^ref$|^num$|^doc$|^check$/.test(s) && bands.refX == null) bands.refX = c.x
        else if (/^(name|payee|vendor)$/.test(s) && bands.nameX == null) bands.nameX = c.x
        else if (/memo|description|desc|narrative|split|particular/.test(s) && bands.descX == null) bands.descX = c.x
        else if (/entity|account|acct/.test(s) && bands.entityX == null) bands.entityX = c.x
        else if (/period/.test(s) && bands.periodX == null) bands.periodX = c.x
      }
    }
  }
  return { idx: anchorIdx, bands }
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

// Drop a leading ENTITY/site id from a multi-entity account heading. A
// multi-entity General Ledger prints the entity id BEFORE the account id on each
// section heading (e.g. "715141 40120 Rental Income"), but the income statement
// it is matched against keys off the ACCOUNT id (40120). So when two or more
// numeric codes lead the label, keep only the LAST one — yielding
// "<account-id> <name>", whose accountCode()/normalizeName() then line up with
// the statement exactly as a single-entity ledger already does. A label with one
// leading code (the ordinary heading) or none is returned unchanged.
function stripEntityPrefix(label) {
  const tokens = String(label).trim().split(/\s+/)
  let codes = 0
  while (codes < tokens.length && /^\d[\d.\-]*$/.test(tokens[codes])) codes++
  if (codes >= 2 && codes < tokens.length) return tokens.slice(codes - 1).join(' ')
  return tokens.join(' ')
}

// A cell that is only punctuation/whitespace (e.g. MRI's "@" column marker) — it
// carries no field content and is dropped from field assignment.
function isPunctCell(str) {
  return /^[^A-Za-z0-9]+$/.test(String(str))
}

// Is this (date-less) line an account-section heading, and if so what is its
// label? Headings take three real-world forms:
//   • carries a "Balance Forward" marker (the account's opening line — note it
//     also prints a balance figure, so it is NOT gated on "no money");
//   • ends with "(Continued)" (the per-page repeat);
//   • a left-margin / code-led text line (the generic / synthetic shape).
// The label is the leading text up to a "Balance Forward" marker, with money
// figures and bare punctuation dropped. Returns '' when the line is not a heading.
function glHeadingLabel(cells, text, moneyStart, headingLeftEdge) {
  if (!/[A-Za-z]/.test(text)) return ''
  const hasMoney = cells.some((c) => c.x >= moneyStart && parseGLMoney(c.str) !== null)
  const isBalFwd = /balance\s+forward/i.test(text)
  const isContinued = /\(continued\)/i.test(text)
  const leftMargin = !hasMoney && (cells[0].x <= headingLeftEdge || GL_CODE_HEADING_RE.test(text))
  if (!isBalFwd && !isContinued && !leftMargin) return ''

  const parts = []
  for (const c of cells) {
    if (/balance\s+forward/i.test(c.str)) break
    if (c.x >= moneyStart && parseGLMoney(c.str) !== null) continue
    if (isPunctCell(c.str)) continue
    parts.push(c.str)
  }
  return stripEntityPrefix(cleanAccountHeading(parts.join(' ')))
}

// Assign a transaction row's text cells to Reference / Vendor / Description by
// nearest detected column band. Entity and Period bands act as sinks so the
// entity/account identifier and the period stamp are absorbed (and dropped)
// rather than polluting the reference or vendor. When no text bands were
// detected at all, everything falls into the vendor (preserves prior behavior).
function assignTextFields(textCells, bands) {
  const targets = []
  if (bands.entityX != null) targets.push(['_sink', bands.entityX])
  if (bands.periodX != null) targets.push(['_sink', bands.periodX])
  if (bands.refX != null) targets.push(['reference', bands.refX])
  if (bands.nameX != null) targets.push(['vendor', bands.nameX])
  if (bands.descX != null) targets.push(['description', bands.descX])

  const out = { reference: [], vendor: [], description: [] }
  if (targets.length === 0) {
    return { reference: '', vendor: textCells.map((c) => c.str).join(' ').trim(), description: '' }
  }
  for (const c of textCells) {
    let best = null
    let bestD = Infinity
    for (const [name, x] of targets) {
      const d = Math.abs(c.x - x)
      if (d < bestD) {
        bestD = d
        best = name
      }
    }
    if (best && best !== '_sink') out[best].push(c.str)
  }
  return {
    reference: out.reference.join(' ').trim(),
    vendor: out.vendor.join(' ').trim(),
    description: out.description.join(' ').trim()
  }
}

// Reconstruct a typed GL table from position-aware line cells. Returns null when
// no GL header (with Debit + Credit columns) is found or no transactions are
// reconstructed, so the caller can fall back cleanly.
function reconstructGLTable(lineCells) {
  if (!Array.isArray(lineCells) || lineCells.length === 0) return null
  const header = detectGLBands(lineCells)
  if (!header) return null

  const { idx, bands } = header
  const anchors = [
    ['debit', bands.debitX],
    ['credit', bands.creditX],
    ['balance', bands.balanceX]
  ].filter(([, x]) => x != null)
  // Numeric tokens left of this x are entity/date/reference/name/memo, not money.
  const moneyStart = Math.min(...anchors.map(([, x]) => x)) - 25
  // A line starting at/near the left margin is an account-section heading; an
  // indented text-only line is a wrapped memo. The left margin is the leftmost
  // detected data column (entity / date / reference).
  const leftCandidates = [bands.entityX, bands.dateX, bands.refX].filter((x) => x != null)
  const headingLeftEdge = (leftCandidates.length ? Math.min(...leftCandidates) : 0) + 12

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

    // A repeated column header at the top of a later page is chrome, not data.
    if (isGLHeaderText(text)) {
      lastTxn = null
      continue
    }

    const dateCell = cells.find((c) => GL_DATE_RE.test(c.str))

    // ---- Transaction: an active account section + a date ----
    if (dateCell && currentAccount) {
      const moneyCells = cells.filter((c) => c !== dateCell && c.x >= moneyStart && parseGLMoney(c.str) !== null)
      let amount = null
      if (moneyCells.length > 0) {
        const assigned = assignAmountBands(moneyCells, anchors)
        if (assigned && (assigned.debit != null || assigned.credit != null)) {
          amount = (assigned.debit || 0) - (assigned.credit || 0)
        }
      }
      // Everything left of the money region (other than the date and bare
      // punctuation) is a text field — including a NUMERIC reference such as a
      // check number. Band assignment routes it; the entity/period sinks drop the
      // entity identifier so it never lands in Reference/Vendor/Description.
      const textCells = cells.filter(
        (c) => c !== dateCell && c.x < moneyStart && !GL_DATE_RE.test(c.str) && !isPunctCell(c.str)
      )
      const { reference, vendor, description } = assignTextFields(textCells, bands)
      // A money-formatted token (e.g. "5,652.22") inside the description or vendor
      // means a value landed OUTSIDE the amount columns — a wrapped or
      // oddly-positioned row whose columnar parse is unreliable. Suppress the
      // amount so a skewed figure never reaches a total (the row still supports
      // count/vendor evidence). This strengthens, never weakens, the gate.
      if (amount != null && /\d[\d,]*\.\d{2}(?!\d)/.test(`${description} ${vendor}`)) amount = null
      const row = [currentAccount, dateCell.str, reference, vendor, description, amount == null ? '' : formatGLAmount(amount)]
      if (dataRows.length < MAX_TABLE_ROWS) {
        dataRows.push(row)
        lastTxn = row
      }
      lastWasTotal = false
      continue
    }
    if (dateCell) continue // dated row before any account heading — skip

    // ---- Total / subtotal / running-balance line ----
    if (GL_TOTAL_RE.test(text)) {
      lastTxn = null
      lastWasTotal = true
      continue
    }

    // ---- Account-section heading ----
    const heading = glHeadingLabel(cells, text, moneyStart, headingLeftEdge)
    if (heading) {
      currentAccount = heading
      sections.push(heading)
      lastTxn = null
      lastWasTotal = false
      continue
    }

    // ---- Wrapped-memo continuation of the previous transaction ----
    const hasMoney = cells.some((c) => c.x >= moneyStart && parseGLMoney(c.str) !== null)
    if (/[A-Za-z]/.test(text) && !hasMoney && lastTxn && !lastWasTotal) {
      lastTxn[4] = lastTxn[4] ? `${lastTxn[4]} ${text}` : text
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

// --- Sectioned GL — TEXT reconstruction (NQ-6C.4) -------------------------
// A second, position-INDEPENDENT path for an account-sectioned PDF General
// Ledger (e.g. the MRI export): when pdf.js x-positions don't resolve into clean
// Debit/Credit bands, reconstructGLTable returns null and the file used to read
// as "No content". This path parses the x-sorted line STRINGS instead, keying
// off textual section markers — a "<code> <Name>" account heading, the
// "Balance Forward" opening marker, and the "** Account Totals" section end. It
// emits the SAME typed table shape as the position-based reconstructor, so the
// evidence index, prepared evidence, and LLM packets consume it identically.
//
// DETERMINISTIC regex parsing only. NO OCR, NO AI/ML. Returns null when no GL
// section/transaction is found, so a non-GL PDF (or an unparseable one) fails
// silently — no error is surfaced and no evidence is produced.

// True when the line strings carry sectioned-GL markers ("Balance Forward" /
// "** Account Totals"). Conservative: a variance report (which carries neither)
// is excluded, so the variance reconstructor is never hijacked.
export function looksLikeSectionedGLText(lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) return false
  if (detectVarianceReport(lines)) return false
  const blob = lines.join(' \n ')
  return /balance\s+forward/i.test(blob) || /\*+\s*account\s+totals\b/i.test(blob)
}

function hasGLDateToken(line) {
  return String(line)
    .split(/\s+/)
    .some((t) => GL_DATE_RE.test(t))
}

// An account-section heading from text: "<code> <Name>", optionally followed by
// the "Balance Forward" opening marker and/or an opening balance figure on the
// same line. A multi-entity ledger prefixes the account id with one or more
// ENTITY/site ids ("715141 40120 Rental Income"); the leading-code run absorbs
// them and the capture keeps the LAST (account) code, so the label keys off the
// account id the income statement uses — never the entity. Returns the cleaned
// "<account-code> <Name>" label, or '' when the line is not a heading. A
// transaction line never matches — it leads with codes then a period/date, so the
// required leading letter (the account name) is absent.
function glTextHeadingLabel(line) {
  const m = String(line).match(/^(?:\d[\d.\-]*\s+)*(\d[\d.\-]*)\s+([A-Za-z].*)$/)
  if (!m) return ''
  const name = m[2]
    .replace(/\s+balance\s+forward\b.*$/i, '') // drop the opening marker + its figure
    .replace(/(?:\s+\(?-?\$?\d[\d,]*(?:\.\d+)?\)?%?)+$/, '') // drop a trailing opening balance
    .trim()
  if (!name) return ''
  return cleanAccountHeading(`${m[1]} ${name}`)
}

// Parse one transaction line of a sectioned GL from its TEXT. Returns
// { date, reference, description, amount } or null when the line is not a dated
// transaction. The trailing run of money tokens is the value region: the first
// is Debit, the second Credit, any third a running Balance (ignored). Per the
// phase contract, amount = debit when debit > 0, else credit negated.
function parseGLTextTransaction(line) {
  const tokens = String(line).split(/\s+/).filter(Boolean)
  // The entry date is the first true date token; a leading entity code and an
  // "MM/YY" period never match GL_DATE_RE, so they are skipped naturally.
  const dateIdx = tokens.findIndex((t) => GL_DATE_RE.test(t))
  if (dateIdx < 0) return null

  // Trailing run of money tokens = the Debit / Credit / [Balance] value columns.
  let moneyStart = tokens.length
  while (moneyStart > dateIdx + 1 && parseGLMoney(tokens[moneyStart - 1]) !== null) moneyStart--
  const money = tokens.slice(moneyStart)
  if (money.length === 0) return null // a dated line with no value is not a usable transaction

  const debit = parseGLMoney(money[0]) || 0
  const credit = (money.length > 1 ? parseGLMoney(money[1]) : 0) || 0
  const amount = debit > 0 ? debit : -credit

  // Text between the date and the value region = reference + description. Pull an
  // optional leading document reference (e.g. "CHK1001", "AP 064697"); the rest
  // is the description/memo the owner-facing commentary can cite.
  const middle = tokens.slice(dateIdx + 1, moneyStart)
  let reference = ''
  let descStart = 0
  if (/^[A-Za-z]{1,4}$/.test(middle[0] || '') && /^\d[\d\-/]*$/.test(middle[1] || '')) {
    reference = `${middle[0]} ${middle[1]}`
    descStart = 2
  } else if (/^[A-Za-z]{0,4}\d[\d\-/]*$/.test(middle[0] || '')) {
    reference = middle[0]
    descStart = 1
  }
  const description = middle.slice(descStart).join(' ').trim()

  return { date: tokens[dateIdx], reference, description, amount }
}

// Reconstruct a typed GL table from x-sorted line STRINGS. Returns null when no
// account section produced a transaction, so the caller can fall back cleanly.
export function reconstructSectionedGLFromText(lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) return null
  const dataRows = []
  const sections = []
  let currentAccount = ''

  for (const raw of lines) {
    const line = String(raw).replace(/\s+/g, ' ').trim()
    if (!line) continue
    if (isGLHeaderText(line)) continue // repeated column header (page chrome)
    if (GL_TOTAL_RE.test(line)) continue // total / subtotal / ** Account Totals

    // Account-section heading (no entry date) opens / switches the section.
    if (!hasGLDateToken(line)) {
      const heading = glTextHeadingLabel(line)
      if (heading) {
        currentAccount = heading
        sections.push(heading)
        continue
      }
    }

    // Transaction row under an active section.
    if (!currentAccount) continue
    const txn = parseGLTextTransaction(line)
    if (!txn) continue
    if (dataRows.length < MAX_TABLE_ROWS) {
      dataRows.push([
        currentAccount,
        txn.date,
        txn.reference,
        '',
        txn.description,
        txn.amount == null ? '' : formatGLAmount(txn.amount)
      ])
    }
  }

  if (dataRows.length === 0) return null
  return {
    name: 'Reconstructed GL',
    rows: [GL_COLUMNS.slice(), ...dataRows],
    columnCount: GL_COLUMNS.length,
    sections
  }
}
