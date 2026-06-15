// --- Variance Engine — Phase 8 --------------------------------------------
// Orchestrates the deterministic pipeline that turns ONE normalized extraction
// (Phase 7 output) into a structured variance result:
//
//   detect columns → align rows → calculate → summarize
//
// Boundaries (Phase 8): calculation only. NO narratives, NO AI/ML, NO exports,
// NO persistence, NO architecture changes. Everything runs in memory for the
// session and is derived purely from the normalized input.
//
// Output contract:
//   { fileId, fileName, baseClassification, comparisons:[...], summary, confidence,
//     comparisonSets:[{ period, comparisons, summary, confidence }] }
//
// Phase 7.1: statements that carry both a Current and a YTD comparison side by
// side now yield one entry per period in `comparisonSets`. The top-level
// `comparisons`/`summary`/`confidence` mirror the Current period so every
// existing consumer keeps working unchanged.

import { detectColumns, detectComparisonSets } from './detectColumns.js'
import { alignRows } from './alignRows.js'
import { calculate } from './calculate.js'
import { summarize } from './summarize.js'
import { DEFAULT_THRESHOLDS } from './thresholds.js'

function empty(base, reason) {
  return {
    ...base,
    columns: { account: null, actual: null, budget: null, prior: null },
    comparisons: [],
    summary: {
      totalRowsReviewed: 0,
      totalVariancesFound: 0,
      highVarianceCount: 0,
      missingDataCount: 0
    },
    confidence: 0,
    reason
  }
}

function overallConfidence(comparisons) {
  if (comparisons.length === 0) return 0
  const sum = comparisons.reduce((acc, c) => acc + (c.confidence || 0), 0)
  return Math.round(sum / comparisons.length)
}

// Compute variance for a single normalized extraction object.
// `thresholds` defaults to the central Phase 8 defaults (amount 1000 / pct 10).
export function computeVariance(extraction, thresholds = DEFAULT_THRESHOLDS) {
  const base = {
    fileId: extraction?.fileId,
    fileName: extraction?.fileName,
    baseClassification: extraction?.classification?.type || null,
    thresholds
  }

  const normalized = extraction?.normalized
  // Variance needs a tabular source. Free-text extractions (no columns) and
  // anything that didn't extract cleanly produce an empty, honest result.
  if (extraction?.status && extraction.status !== 'ok') return empty(base, 'not-extracted')
  if (!normalized || !Array.isArray(normalized.columns) || normalized.columns.length === 0) {
    return empty(base, 'not-tabular')
  }

  const rows = Array.isArray(normalized.rows) ? normalized.rows : []
  const { account, sets } = detectComparisonSets(normalized.columns, rows)

  // Compute one comparison set per detected period that actually has an actual
  // column plus a budget or prior to compare against. The account/label column
  // is shared across every period.
  const comparisonSets = []
  for (const set of sets) {
    const columns = { account, ...set.columns }
    const hasActual = columns.actual !== null
    const hasComparison = columns.budget !== null || columns.prior !== null
    if (!hasActual || !hasComparison) continue

    const aligned = alignRows(rows, columns)
    const comparisons = calculate(aligned, thresholds, extraction.confidence)
    const summary = summarize(comparisons, rows.length)
    comparisonSets.push({
      period: set.period,
      columns,
      comparisons,
      summary,
      confidence: overallConfidence(comparisons)
    })
  }

  // Without any comparable period there is nothing to compute. Report the shape
  // honestly rather than inventing numbers.
  if (comparisonSets.length === 0) {
    const result = empty(base, 'no-comparable-columns')
    result.columns = { account, actual: null, budget: null, prior: null }
    result.summary.totalRowsReviewed = rows.length
    return result
  }

  // Top-level fields mirror the Current period for backward compatibility,
  // falling back to the first available set when no Current period is present.
  const primary = comparisonSets.find((s) => s.period === 'current') || comparisonSets[0]

  return {
    ...base,
    columns: primary.columns,
    comparisons: primary.comparisons,
    summary: primary.summary,
    confidence: primary.confidence,
    comparisonSets
  }
}

export { detectColumns, detectComparisonSets, alignRows, calculate, summarize, DEFAULT_THRESHOLDS }
