// --- Narrative engine — Phase 9A ------------------------------------------
// Turns ONE deterministic variance result (Phase 8 output) into an owner-ready
// narrative. The engine reads only what the variance step already computed; it
// performs no extraction, no math beyond summing figures already on the
// records, and — per the hard boundaries of this phase — NO AI/LLM, NO export,
// NO persistence, NO network.
//
// Input (a `computeVariance` result, or its destructured parts):
//   { comparisonSets, summary, thresholds, baseClassification, ... }
// Output:
//   { fileId, fileName, classification, thresholds, periods: [perPeriod...] }
// where each perPeriod is the spec output contract:
//   { period, periodLabel, executiveSummary, highVariances, missingData,
//     revenueNotes, expenseNotes, sourceRows }
//
// Backward compatible: a result that only carries the flat top-level shape
// (no comparisonSets) is treated as a single "current" period.

import { DEFAULT_THRESHOLDS } from '../variance/thresholds.js'
import {
  buildExecutiveSummary,
  buildHighVariances,
  buildMissingData,
  buildRevenueNotes,
  buildExpenseNotes,
  buildAllVariances,
  unionSourceRows
} from './sections.js'
import { periodLabel } from './formatters.js'
import { buildCommentaryPlan } from '../plan/commentaryPlan.js'

// Normalize whatever was passed into an ordered list of comparison sets.
// Accepts a full variance result, or a bare { comparisonSets } / { comparisons }.
function resolveSets(input) {
  if (!input || typeof input !== 'object') return []
  if (Array.isArray(input.comparisonSets) && input.comparisonSets.length > 0) {
    return input.comparisonSets
  }
  // Flat/legacy shape: a single current period built from top-level fields.
  if (Array.isArray(input.comparisons)) {
    return [{ period: 'current', comparisons: input.comparisons, summary: input.summary }]
  }
  return []
}

// Build the five sections for a single comparison set.
export function buildPeriodNarrative(set, thresholds) {
  const period = set.period || 'current'
  const comparisons = Array.isArray(set.comparisons) ? set.comparisons : []

  const executiveSummary = buildExecutiveSummary(comparisons, period, thresholds)
  const highVariances = buildHighVariances(comparisons)
  const missingData = buildMissingData(comparisons)
  const revenueNotes = buildRevenueNotes(comparisons)
  const expenseNotes = buildExpenseNotes(comparisons)
  // The complete variance table for the Excel export (Phase 21.6). Additive and
  // export-only — no owner-facing narrative section reads it, so Markdown/DOCX
  // and the on-screen summary stay byte-identical.
  const allVariances = buildAllVariances(comparisons)

  // NQ-3A — Commentary Planning Layer (INERT). A deterministic plan of how each
  // row would be narrated (disposition / materiality / theme / owner question),
  // attached for LATER phases to consume. Nothing reads it yet, so every section
  // below and every export/preview stays byte-identical. Additive, like
  // `allVariances` above.
  const plan = buildCommentaryPlan(comparisons, { thresholds })

  // Top-level traceability: every source row any sentence in this period drew on.
  const sourceRows = unionSourceRows([
    ...executiveSummary,
    ...highVariances,
    ...missingData,
    ...revenueNotes,
    ...expenseNotes
  ])

  return {
    period,
    periodLabel: periodLabel(period),
    executiveSummary,
    highVariances,
    missingData,
    revenueNotes,
    expenseNotes,
    allVariances,
    plan,
    sourceRows
  }
}

// Generate the narrative for one variance result.
export function generateNarrative(varianceResult, options = {}) {
  const thresholds =
    varianceResult?.thresholds || options.thresholds || DEFAULT_THRESHOLDS
  const sets = resolveSets(varianceResult)
  const periods = sets.map((set) => buildPeriodNarrative(set, thresholds))

  return {
    fileId: varianceResult?.fileId ?? null,
    fileName: varianceResult?.fileName ?? null,
    classification: varianceResult?.baseClassification ?? null,
    thresholds,
    periods
  }
}

// Convenience: generate narratives for an ordered list of variance results.
export function generateNarratives(results = [], options = {}) {
  return (Array.isArray(results) ? results : [])
    .filter(Boolean)
    .map((r) => generateNarrative(r, options))
}
