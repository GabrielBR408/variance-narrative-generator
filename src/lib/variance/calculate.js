// --- Variance calculation — Phase 8 ---------------------------------------
// The arithmetic core: for each aligned row, compute the dollar and percent
// movement of actual against its comparison, classify it favorable/unfavorable/
// neutral using a deterministic account heuristic, and flag it against the
// central thresholds.
//
// Pure functions, deterministic, no AI/ML, no persistence, no text generation.

import { DEFAULT_THRESHOLDS, isTriggered } from './thresholds.js'

// Account-type heuristics. Expense is tested first because expense-ish wording
// ("cost of sales", "sales tax") would otherwise be miscaught by the broad
// revenue word "sales". Anything unmatched stays unknown → neutral.
const EXPENSE_RE =
  /expense|cost|\bcogs\b|salar|wage|payroll|\brent\b|utilit|deprec|amorti|insurance|supplies|maintenance|repair|\btax(es)?\b|overhead|freight|marketing|advertis|interest\s*expense|fees?\s*(paid|expense)|\badmin(?:istrat\w*)?\b|spend/i
const REVENUE_RE =
  /revenue|\bsales\b|\bincome\b|\bfees?\b|turnover|proceeds|receipts?|earnings|billings/i

// A bare "fee/fees" word is ambiguous: on an owner/operator statement an
// unqualified fee line (management, admin, legal, professional, asset-management)
// is an expense the owner PAYS, not income. It only reads as revenue when the
// label explicitly says so ("Fee Income", "fee revenue"). Without this guard a
// plain "Admin Fee" matched the broad revenue \bfees?\b and was mislabeled
// revenue, which then flipped its favorable/unfavorable direction.
const FEE_RE = /\bfees?\b/i
const REVENUE_QUALIFIER_RE = /\bincome\b|revenue/i

// Returns 'revenue' | 'expense' | 'unknown'.
export function accountType(account = '') {
  const name = String(account)
  if (EXPENSE_RE.test(name)) return 'expense'
  // Unqualified fee (no income/revenue word) → expense, not revenue.
  if (FEE_RE.test(name) && !REVENUE_QUALIFIER_RE.test(name)) return 'expense'
  if (REVENUE_RE.test(name)) return 'revenue'
  return 'unknown'
}

// Map an account type + variance direction to favorable / unfavorable / neutral.
//   Revenue: more than comparison is good.
//   Expense: less than comparison is good.
//   Unknown: no opinion.
export function classify(type, varianceAmount) {
  if (type === 'unknown' || typeof varianceAmount !== 'number' || !Number.isFinite(varianceAmount)) {
    return 'neutral'
  }
  if (varianceAmount === 0) return 'neutral'
  const positive = varianceAmount > 0
  if (type === 'revenue') return positive ? 'favorable' : 'unfavorable'
  // expense
  return positive ? 'unfavorable' : 'favorable'
}

// Coarse per-row confidence: complete data with a known account type is the most
// trustworthy; missing a side of the comparison is the least. Bounded by the
// upstream extraction confidence so this never claims more certainty than the read.
function rowConfidence(hasActual, hasComparison, type, fileConfidence) {
  let c
  if (!hasActual || !hasComparison) c = 40
  else if (type === 'unknown') c = 75
  else c = 95
  const ceiling = Number.isFinite(fileConfidence) ? fileConfidence : 100
  return Math.min(c, ceiling)
}

// Compute one comparison record from an aligned row.
// Comparison basis: prefer budget, fall back to prior (spec: actual − comparison).
export function calculateRow(aligned, thresholds = DEFAULT_THRESHOLDS, fileConfidence = 100) {
  const { account, actual, budget, prior, sourceRows } = aligned

  const hasBudget = typeof budget === 'number' && Number.isFinite(budget)
  const hasPrior = typeof prior === 'number' && Number.isFinite(prior)
  const hasActual = typeof actual === 'number' && Number.isFinite(actual)

  const comparisonType = hasBudget ? 'budget' : hasPrior ? 'prior' : null
  const comparison = hasBudget ? budget : hasPrior ? prior : null
  const hasComparison = comparison !== null

  let varianceAmount = null
  let variancePercent = null
  if (hasActual && hasComparison) {
    varianceAmount = actual - comparison
    // Percent is undefined against a zero base (spec: comparison == 0 ? null).
    // Stored as a whole-number percent so it lines up with the percent threshold
    // and the "Variance %" display.
    variancePercent = comparison === 0 ? null : (varianceAmount / Math.abs(comparison)) * 100
  }

  const type = accountType(account)
  const category = classify(type, varianceAmount)
  const thresholdTriggered =
    varianceAmount === null ? false : isTriggered(varianceAmount, variancePercent, thresholds)
  const missingData = !hasActual || !hasComparison

  return {
    account,
    actual: hasActual ? actual : null,
    budget: hasBudget ? budget : null,
    prior: hasPrior ? prior : null,
    varianceAmount,
    variancePercent,
    comparisonType,
    thresholdTriggered,
    category,
    accountType: type,
    missingData,
    confidence: rowConfidence(hasActual, hasComparison, type, fileConfidence),
    sourceRows: Array.isArray(sourceRows) ? sourceRows : []
  }
}

// Calculate every aligned row. Linear pass, no row-vs-row matching.
export function calculate(alignedRows = [], thresholds = DEFAULT_THRESHOLDS, fileConfidence = 100) {
  return alignedRows.map((row) => calculateRow(row, thresholds, fileConfidence))
}
