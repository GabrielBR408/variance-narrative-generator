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
//   { fileId, fileName, baseClassification, comparisons:[...], summary, confidence }

import { detectColumns } from './detectColumns.js'
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
  const columns = detectColumns(normalized.columns, rows)

  // Without an actual column AND at least one comparison column there is nothing
  // to compute. Report the shape honestly rather than inventing numbers.
  const hasActual = columns.actual !== null
  const hasComparison = columns.budget !== null || columns.prior !== null
  if (!hasActual || !hasComparison) {
    const result = empty(base, 'no-comparable-columns')
    result.columns = columns
    result.summary.totalRowsReviewed = rows.length
    return result
  }

  const aligned = alignRows(rows, columns)
  const comparisons = calculate(aligned, thresholds, extraction.confidence)
  const summary = summarize(comparisons, rows.length)

  return {
    ...base,
    columns,
    comparisons,
    summary,
    confidence: overallConfidence(comparisons)
  }
}

export { detectColumns, alignRows, calculate, summarize, DEFAULT_THRESHOLDS }
