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
export const SECTIONED_GL = 'sectioned_gl'
export const BUDGET_SUMMARY = 'budget_summary'

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
