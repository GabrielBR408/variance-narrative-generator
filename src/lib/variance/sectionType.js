// --- Income-statement section typing — Fix B (revised) --------------------
// Authoritative revenue-vs-expense classification driven by a line's POSITION in
// the income statement, NOT by its account name. On real statements an account
// NAME is unreliable (e.g. "Admin Fee" can roll up into TOTAL OTHER INCOME, i.e.
// it is income), so the trustworthy signal is which section subtotal a detail
// line rolls into.
//
// What reliably survives extraction: section SUBTOTAL lines (e.g. "TOTAL OTHER
// INCOME", "TOTAL REVENUE", "TOTAL OPERATING EXPENSES") carry numbers, so they
// remain in the normalized rows in source order. (Label-only section HEADER rows
// carry no numbers and are dropped during alignment, so headers are not relied
// on here.) A detail line therefore belongs to the section of the NEXT section
// subtotal that appears below it.
//
// Pure and deterministic. No AI, no math, no thresholds. Returns a per-row map so
// the caller can attach the type to each computed comparison via its source row.

// A section subtotal that DEFINES membership. "NET …"/grand totals are excluded
// on purpose — they aggregate across both sides (e.g. "NET OPERATING INCOME")
// and by their position every detail line has already been assigned by the
// TOTAL/SUBTOTAL line of its own section above them.
// Leading spaces / asterisks / bullets are tolerated, mirroring pdfGL.js — real
// exports (e.g. MRI) print subtotals like "** TOTAL OTHER INCOME".
const SECTION_TOTAL_RE = /^[\s*•·-]*(total|subtotal|gross)\b/i

// Side keywords carried by a section subtotal label. Expense is tested first so a
// hybrid like "TOTAL COST OF SALES" reads as expense rather than revenue.
const EXPENSE_SECTION_RE = /\b(expense|expenses|cost|costs|cogs)\b/i
const REVENUE_SECTION_RE = /\b(revenue|income|sales)\b/i

// The income-statement side a subtotal line defines, or null when the label is
// not a section subtotal (a detail line, a coded account, or a NET/grand total).
export function rollupSide(label = '') {
  const s = String(label).trim()
  if (!s) return null
  if (/^\s*\d/.test(s)) return null // coded account (e.g. "54110 …") → a real line
  if (!SECTION_TOTAL_RE.test(s)) return null
  if (EXPENSE_SECTION_RE.test(s)) return 'expense'
  if (REVENUE_SECTION_RE.test(s)) return 'revenue'
  return null // e.g. "GROSS PROFIT" — no clear side; leave to fallback
}

// Walk the rows in source order and assign each one the section side it rolls
// into. Detail (and label-only header) rows are buffered until the next section
// subtotal is reached, then assigned that subtotal's side; the subtotal row
// itself gets the same side. Rows after the final section subtotal stay null, so
// the caller falls back to the account-name heuristic for them.
//
//   rows         : normalized data rows (arrays of cell values)
//   accountIndex : the detected account/label column index
// Returns an array (indexed by row) of 'revenue' | 'expense' | null.
export function assignSectionTypes(rows = [], accountIndex = null) {
  const n = Array.isArray(rows) ? rows.length : 0
  const byRow = new Array(n).fill(null)
  if (n === 0 || accountIndex === null || accountIndex === undefined) return byRow

  let buffer = []
  for (let r = 0; r < n; r++) {
    const row = rows[r]
    const cell = Array.isArray(row) ? row[accountIndex] : undefined
    const label = cell === null || cell === undefined ? '' : String(cell).trim()
    const side = rollupSide(label)
    if (side) {
      for (const i of buffer) byRow[i] = side
      byRow[r] = side
      buffer = []
    } else {
      buffer.push(r)
    }
  }
  // Trailing buffer (rows below the last section subtotal) is intentionally left
  // null → account-name fallback in calculate().
  return byRow
}
