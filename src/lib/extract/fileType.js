// --- Supporting file-type detection — NQ-6C.2 -----------------------------
// Content-based detection + parsing for two supporting-file shapes the flat
// row/column normalizer cannot read on its own. Detection runs at parse time,
// so the app routes each uploaded file to the right handling WITHOUT the user
// labelling it.
//
//   • Sectioned GL — a general ledger grouped BY ACCOUNT. Each account section
//     opens with a header row (account name in col 3, "Balance Forward" in
//     col 9) and is then followed by individual transaction rows. The account
//     name lives on the section header, NOT on each transaction row, so the
//     flat parser (which expects a per-row account column) indexes nothing. We
//     flatten the sections into a one-transaction-per-row table that carries the
//     section's account name onto every row — a shape the existing evidence
//     index (enrich/match.js) already knows how to consume.
//
//   • Budget summary — a by-account budget/actual/variance summary (Current +
//     YTD Actual/Budget/Variance). It carries NO transaction detail, vendor, or
//     memo, so it is useful for variance confirmation only and must never be
//     mined for GL evidence rows.
//
// Pure & deterministic: the same grid in always yields the same classification
// and the same flattened rows out. NO AI/LLM, NO network, NO variance math.
//
// (Imports looksLikeDate from normalize.js. normalize.js imports the detectors
// here in turn — a load-time cycle that is safe because neither side CALLS the
// other's bindings until runtime, and the bindings it relies on are hoisted.)

import { looksLikeDate } from './normalize.js'

// normalized.fileType tags. Consumed by enrich/match.js: SECTIONED_GL rows are
// already flattened to a GL shape; BUDGET_SUMMARY files are skipped entirely.
// STANDALONE_BUDGET marks a content-detected budget (budget basis, no actuals/
// variance) so enrich/budgetContext.js (Phase 2B) mines it even when its filename
// implied another type (e.g. a real budget exported as "GL Worksheet").
export const SECTIONED_GL = 'sectioned_gl'
export const BUDGET_SUMMARY = 'budget_summary'
export const STANDALONE_BUDGET = 'standalone_budget'

// Flattened column layout produced from a sectioned GL. Headers are chosen so
// the evidence index types them correctly: "Account" is the account label;
// "Memo" is the description (a detail/description column that is deliberately
// NOT account-like, so it never steals the account column); "Reference" is a
// detail-only column (never rendered); "Debit"/"Credit"/"Balance" are the typed
// amounts the prepared-evidence layer nets (debit − credit; balance excluded).
export const SECTIONED_GL_COLUMNS = ['Account', 'Date', 'Reference', 'Memo', 'Debit', 'Credit', 'Balance']

// Column positions in the RAW sectioned-GL grid (from the diagnostic logs):
// 0 entity · 1 period · 3 date · 4 source · 5 reference · 9 description/memo ·
// 10 debit · 11 credit · 12 balance.
const SRC_DATE = 3
const SRC_REFERENCE = 5
const SRC_MEMO = 9
const SRC_DEBIT = 10
const SRC_CREDIT = 11
const SRC_BALANCE = 12

// A section header carries the account name in col 3 and the "Balance Forward"
// marker in col 9 of the SAME row.
const HDR_NAME = SRC_DATE
const HDR_MARK = SRC_MEMO
const BALANCE_FORWARD_RE = /balance\s*forward/i

function cellText(row, i) {
  const v = row && row[i]
  return v === null || v === undefined ? '' : String(v).trim()
}

// A section header opens an account: the "Balance Forward" marker in col 9 and a
// non-date label in col 3 on the same row.
function isSectionHeader(row) {
  if (!BALANCE_FORWARD_RE.test(cellText(row, HDR_MARK))) return false
  const name = cellText(row, HDR_NAME)
  return name !== '' && !looksLikeDate(name)
}

// A transaction row carries a real date in col 3. Section headers, totals /
// subtotals, and report-metadata rows never do, so the date is the reliable
// discriminator that keeps a section total out of the transaction list.
function isTransactionRow(row) {
  return looksLikeDate(cellText(row, SRC_DATE))
}

// True when the grid is an account-sectioned GL: at least one "Balance Forward"
// section header is present. That marker is specific enough that flat tables,
// budget summaries, and comparative statements never trip it.
export function detectSectionedGL(grid) {
  if (!Array.isArray(grid)) return false
  for (const row of grid) {
    if (Array.isArray(row) && isSectionHeader(row)) return true
  }
  return false
}

// Flatten a sectioned GL into one-transaction-per-row, carrying each section's
// account name onto every transaction beneath it. Rows before the first section
// header, section totals/subtotals, and blank/metadata rows are dropped.
// Returns { columns, rows } in the SECTIONED_GL_COLUMNS shape.
export function parseSectionedGL(grid) {
  const rows = []
  if (!Array.isArray(grid)) return { columns: [...SECTIONED_GL_COLUMNS], rows }
  let account = null
  for (const row of grid) {
    if (!Array.isArray(row)) continue
    if (isSectionHeader(row)) {
      account = cellText(row, HDR_NAME)
      continue
    }
    if (!account) continue
    if (!isTransactionRow(row)) continue
    rows.push([
      account,
      cellText(row, SRC_DATE),
      cellText(row, SRC_REFERENCE),
      cellText(row, SRC_MEMO),
      cellText(row, SRC_DEBIT),
      cellText(row, SRC_CREDIT),
      cellText(row, SRC_BALANCE)
    ])
  }
  return { columns: [...SECTIONED_GL_COLUMNS], rows }
}

// Budget-summary signature: an account column plus the Current and YTD
// Actual/Budget/Variance value columns. Requiring the full set keeps a real GL,
// a prior-month report, or a single-period statement from matching.
export function detectBudgetSummary(columns) {
  if (!Array.isArray(columns) || columns.length === 0) return false
  const cols = columns.map((c) => String(c).toLowerCase())
  const has = (re) => cols.some((c) => re.test(c))
  const ytd = '(?:ytd|year[\\s-]*to[\\s-]*date)'
  return (
    has(/account/) &&
    has(/current.*actual/) &&
    has(/current.*budget/) &&
    has(/current.*variance/) &&
    has(new RegExp(`${ytd}.*actual`)) &&
    has(new RegExp(`${ytd}.*budget`)) &&
    has(new RegExp(`${ytd}.*variance`))
  )
}

// --- Month-column detection (shared) --------------------------------------
// Lifted into the extract layer so BOTH the standalone-budget detector below and
// enrich/budgetContext.js (Phase 2B phasing) share ONE month-run detector. The
// dependency direction is enrich -> extract (budgetContext already imports from
// this module), so there is no import cycle. Abbreviations match on a word
// boundary so "may" inside a longer word never trips, and a full month header
// ("January") still matches.
export const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_FULL_LC = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
]

// A monthly layout must show most of the year before it counts as a budget
// phasing grid (or as the month-run budget basis below).
export const MIN_MONTH_COLS = 6

// 0-based month index a header names, or -1. Matches either the FULL month name
// ("January") or the 3-letter abbreviation ("Jan", "Jan-26") on a word boundary,
// so "may" buried inside a longer word never trips but a real month header always
// does. Pure; same input ⇒ same output.
export function monthIndexOf(header) {
  const h = String(header).toLowerCase()
  for (let i = 0; i < 12; i++) {
    if (new RegExp(`(^|[^a-z])${MONTH_FULL_LC[i]}([^a-z]|$)`).test(h)) return i
    if (new RegExp(`(^|[^a-z])${MONTH_ABBR[i]}([^a-z]|$)`).test(h)) return i
  }
  return -1
}

// The month columns in a header row, as { col, month } in column order.
export function monthCols(columns) {
  const out = []
  if (!Array.isArray(columns)) return out
  for (let i = 0; i < columns.length; i++) {
    const m = monthIndexOf(columns[i])
    if (m >= 0) out.push({ col: i, month: m })
  }
  return out
}

// --- Standalone-budget content signature ----------------------------------
// A STANDALONE budget is defined structurally, by content alone:
//   • a BUDGET BASIS — a Budget/Forecast/Plan column, OR a run of >= 6 month
//     columns (the annual phasing grid);  AND
//   • NO Actuals  AND  NO Variance        — this is what separates it from a base
//     comparative statement, which always carries Actual + Variance;  AND
//   • NO GL signal (no Debit AND Credit)  — a general ledger is ruled out first.
//
// The conditions are a STRICT AND: a month run on its own is NEVER sufficient, so
// a monthly *actuals* report (months + an Actual column) fails it, and a real
// base report or GL can never match. Mirrors the precedence GL -> BASE -> BUDGET:
// because BUDGET requires the absence of the actuals/variance/GL signals the
// other two are defined by, the two presence-based types always win.
const BUDGET_BASIS_RE = /\bbudget\b|\bforecast\b|\bplan(?:ned)?\b/i
const ACTUAL_COL_RE = /\bactuals?\b/i
const VARIANCE_COL_RE = /\bvariance\b/i
const DEBIT_COL_RE = /\bdebit\b|\bdr\b/i
const CREDIT_COL_RE = /\bcredit\b|\bcr\b/i

export function detectStandaloneBudget(columns) {
  if (!Array.isArray(columns) || columns.length === 0) return false
  const cols = columns.map((c) => String(c))
  const has = (re) => cols.some((c) => re.test(c))
  // Presence-based exclusions first (precedence: GL, then BASE, then BUDGET).
  if (has(DEBIT_COL_RE) && has(CREDIT_COL_RE)) return false // GL
  if (has(ACTUAL_COL_RE)) return false // base report carries Actuals
  if (has(VARIANCE_COL_RE)) return false // base report carries Variance
  // Budget basis: an explicit budget/forecast column OR an annual month run.
  const hasBudgetCol = has(BUDGET_BASIS_RE)
  const hasMonthRun = monthCols(cols).length >= MIN_MONTH_COLS
  return hasBudgetCol || hasMonthRun
}
