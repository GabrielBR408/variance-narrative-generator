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

import { detectComparisonSets } from './detectColumns.js'
import { alignRows } from './alignRows.js'
import { calculate } from './calculate.js'
import { summarize } from './summarize.js'
import { assignSectionTypes, isRollupLabel, rollupSide } from './sectionType.js'
import { DEFAULT_THRESHOLDS, isZeroNoiseVariance } from './thresholds.js'

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

// --- Credit-sign convention (QA fix) ---------------------------------------
// Trial-balance-style exports print income as NEGATIVE numbers (credits) on
// both actual and budget. On such a statement "actual − budget" moves the
// OPPOSITE way from the business reality: actual −29,517 against budget
// −37,392 is a POSITIVE arithmetic variance but $7,875 LESS income than
// planned — unfavorable, not favorable. Detection is deliberately strict so a
// natural-sign statement can never flip: EVERY revenue section subtotal
// ("TOTAL INCOME", "TOTAL REVENUE"…) must be negative on both its actual and
// its comparison, and at least one such subtotal must exist. Contra lines
// (vacancy, concessions) inside a natural-sign statement never make the
// section SUBTOTAL negative, so they cannot trip this. Only the
// favorable/unfavorable CATEGORY is flipped — every dollar figure, variance
// amount, and percent stays exactly as computed from the source, and the set
// is marked `creditConvention: true` so consumers can disclose the reading.
function applyCreditConventionFlip(comparisons) {
  const revenueSubtotals = comparisons.filter(
    (c) => c && rollupSide(c.account) === 'revenue'
  )
  if (revenueSubtotals.length === 0) return false
  const allCredit = revenueSubtotals.every((c) => {
    const comparison = c.budget !== null ? c.budget : c.prior
    return (
      typeof c.actual === 'number' && c.actual < 0 &&
      typeof comparison === 'number' && comparison < 0
    )
  })
  if (!allCredit) return false
  for (let i = 0; i < comparisons.length; i++) {
    const c = comparisons[i]
    if (!c || c.accountType !== 'revenue' || isRollupLabel(c.account)) continue
    if (c.category === 'favorable') comparisons[i] = { ...c, category: 'unfavorable', creditConvention: true }
    else if (c.category === 'unfavorable') comparisons[i] = { ...c, category: 'favorable', creditConvention: true }
  }
  return true
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

  // Authoritative revenue/expense classification by income-statement section: map
  // each data row to the side of the subtotal it rolls into (e.g. a line above
  // "TOTAL OTHER INCOME" is revenue). Shared across every period since the row
  // order is identical; calculate() applies it per row via its source index.
  const sectionByRow = assignSectionTypes(rows, account)

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
    // Section subtotal / grand-total / NOI rows carry figures, so they parse as
    // rows — but they are sums of the detail lines already compared and must never
    // be FLAGGED or narrated (a note like "TOTAL OPERATING EXPENSES exceeded
    // budget…" is pure noise). We keep them in the result — the export intentionally
    // renders the COMPLETE statement, totals included — but clear their trigger so
    // they drop out of the flagged counts, the high-variance headline, and every
    // narrative section. (assignSectionTypes still runs on the full rows above, so
    // these subtotal rows keep doing their real job: typing the detail lines
    // revenue vs expense.)
    const comparisons = calculate(aligned, thresholds, extraction.confidence, sectionByRow).map(
      (c) => {
        if (!c) return c
        if (isRollupLabel(c.account)) {
          // Neutralize EVERY rollup row, triggered or not: an untriggered
          // "TOTAL OPERATING EXPENSES" previously kept its Favorable label
          // while a triggered "TOTAL INCOME" exported as Neutral — same row
          // kind, inconsistent presentation.
          return c.thresholdTriggered || c.category !== 'neutral'
            ? { ...c, thresholdTriggered: false, category: 'neutral' }
            : c
        }
        // NQ-2C at the engine level: a sub-$1 movement that percent-triggered
        // is cleared here so the flagged COUNT the preview and summary report
        // matches the narrative, which has always suppressed these rows.
        if (c.thresholdTriggered && isZeroNoiseVariance(c)) {
          return { ...c, thresholdTriggered: false }
        }
        return c
      }
    )
    const creditConvention = applyCreditConventionFlip(comparisons)
    const summary = summarize(comparisons, rows.length)
    comparisonSets.push({
      period: set.period,
      columns,
      comparisons,
      summary,
      confidence: overallConfidence(comparisons),
      creditConvention
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

export { detectComparisonSets, alignRows, calculate, summarize, DEFAULT_THRESHOLDS }
