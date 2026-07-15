// --- Variance calculation — Phase 8 ---------------------------------------
// The arithmetic core: for each aligned row, compute the dollar and percent
// movement of actual against its comparison, classify it favorable/unfavorable/
// neutral from the section-derived income-statement side (never the account
// name), and flag it against the central thresholds.
//
// Pure functions, deterministic, no AI/ML, no persistence, no text generation.

import { DEFAULT_THRESHOLDS, isTriggered } from './thresholds.js'

// --- Favorability is SECTION-DRIVEN, never keyword-driven -------------------
// The authoritative revenue/expense signal is a line's POSITION in the income
// statement (which section subtotal it rolls into); see ./sectionType.js. An
// account NAME is NOT a reliable signal: generic words fire on the wrong side
// (a revenue line "Base Rent - NNN" matched an expense pattern via \brent\b; a
// genuine "R&M - General Building" repair matched nothing at all and read
// Neutral). The old EXPENSE_RE / REVENUE_RE keyword classifier has therefore
// been REMOVED — no line's direction may depend on its account-name text.
//
// `accountType` is retained as a neutralized no-op so any remaining importer
// still resolves, but it deliberately never reads the name: a line whose
// income-statement section cannot be resolved has NO favorability opinion
// ('unknown' → neutral), rather than a guessed one from keywords.
export function accountType(/* account */) {
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
// `sectionType` is the authoritative revenue/expense classification derived from
// the line's section subtotal (see ./sectionType.js). When it is null (the line's
// section could not be resolved) we fall back to the account-name heuristic.
export function calculateRow(aligned, thresholds = DEFAULT_THRESHOLDS, fileConfidence = 100, sectionType = null) {
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

  // Type is ENTIRELY section-derived. A line whose section subtotal could not be
  // resolved stays 'unknown' (→ neutral); its direction is never inferred from
  // the account name. This is the intended architecture: favorable/unfavorable
  // depends only on which subtotal a line rolls into, so a contra-revenue line
  // in the revenue section (e.g. Vacancy Loss) is typed 'revenue' and a
  // worse-than-budget (more-negative) movement correctly reads unfavorable.
  const type = sectionType === 'revenue' || sectionType === 'expense' ? sectionType : 'unknown'
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
// `sectionByRow` (optional) maps an original data-row index to its section-derived
// type ('revenue' | 'expense' | null); each aligned row carries its originating
// index in `sourceRows`, so the authoritative type follows the row.
export function calculate(alignedRows = [], thresholds = DEFAULT_THRESHOLDS, fileConfidence = 100, sectionByRow = null) {
  return alignedRows.map((row) => {
    const srcRow = Array.isArray(row.sourceRows) ? row.sourceRows[0] : undefined
    const sectionType =
      sectionByRow && srcRow !== undefined && srcRow !== null ? sectionByRow[srcRow] : null
    return calculateRow(row, thresholds, fileConfidence, sectionType)
  })
}
