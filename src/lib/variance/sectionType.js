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

// Grand-total / net rows that aggregate ACROSS sections (Net Operating Income,
// Grand Total, Net Income/Loss). Like section subtotals, these are never a
// variance LINE ITEM — they are sums of lines already compared — so they are
// excluded from the comparison set, not just typed.
const NET_TOTAL_RE =
  /^[\s*•·-]*(net\s+(operating\s+)?(income|loss|profit)|noi\b|grand[\s-]*total|net\s+(change|total))/i

// Intermediate NET/GROSS roll-up lines (e.g. "NET OPERATING INCOME", "GROSS
// PROFIT", "NET CASH FLOW"). They aggregate across both sides, so they define
// no section — but they are still roll-ups, not detail lines. Only GENUINE
// aggregate phrases match: a detail income line that merely starts with the
// word ("Gross Potential Rent", "Gross Scheduled Income") is a real account.
// Leading spaces / asterisks / bullets are tolerated, mirroring SECTION_TOTAL_RE.
const NET_GROSS_ROLLUP_RE =
  /^[\s*•·-]*(net|gross)\s+(operating\s+)?(income|profit|margin|loss|revenue|expenses?|cash\s*flow)\b/i
export function isNetGrossRollup(label = '') {
  const s = String(label).trim()
  if (!s) return false
  if (/^\s*\d/.test(s)) return false // coded account (e.g. "54110 …") → a real line
  return NET_GROSS_ROLLUP_RE.test(s)
}

// A total/subtotal prefix that marks a section roll-up. Deliberately NARROWER
// than SECTION_TOTAL_RE here: a bare "gross" prefix must not flag real detail
// income lines ("Gross Potential Rent") — genuine net/gross aggregates are
// matched by NET_GROSS_ROLLUP_RE / NET_TOTAL_RE instead.
const TOTAL_PREFIX_RE = /^[\s*•·-]*(total|subtotal)\b/i

// True when a label is a section subtotal ("TOTAL OPERATING EXPENSES") or a grand/
// net total ("NET OPERATING INCOME", "GROSS PROFIT"). Used to keep these aggregate
// rows out of the flagged line-item comparisons and the narrative, where
// commenting on a subtotal (a sum of lines already commented) is always noise.
// Mirrors rollupSide's guard: a coded account line ("6110 …") is a real line,
// never a rollup.
export function isRollupLabel(label = '') {
  const s = String(label).trim()
  if (!s) return false
  if (/^\s*\d/.test(s)) return false
  return TOTAL_PREFIX_RE.test(s) || NET_TOTAL_RE.test(s) || isNetGrossRollup(s)
}

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
    } else if (isNetGrossRollup(label)) {
      // An intermediate NET/GROSS roll-up sums the sections ABOVE it — it never
      // rolls into the NEXT section's subtotal like a buffered detail line
      // would (a mid-statement "NET OPERATING INCOME" must not inherit the
      // following expense section's side and read inverted). Left null → the
      // caller falls back to the account-name heuristic, which reads the
      // aggregate's OWN wording (income → revenue) instead of its neighbor's.
    } else {
      buffer.push(r)
    }
  }
  // Trailing buffer (rows below the last section subtotal) is intentionally left
  // null → account-name fallback in calculate().
  return byRow
}
