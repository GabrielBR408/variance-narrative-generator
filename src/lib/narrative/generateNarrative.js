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
  buildContextNotes,
  buildReviewItems,
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
    // An empty-with-reason variance result (computeVariance's empty() shape,
    // e.g. 'no-comparable-columns' / 'not-tabular') has nothing to narrate.
    // Fabricating a "current" period here would render a false "no variances
    // crossed the thresholds" clean bill of health for an uncomparable base —
    // zero periods lets the exports' honest "No comparable variance data was
    // found…" message fire instead, matching the preview's empty state.
    if (input.comparisons.length === 0 && input.reason) return []
    return [{ period: 'current', comparisons: input.comparisons, summary: input.summary }]
  }
  return []
}

// Build the five sections for a single comparison set.
export function buildPeriodNarrative(set, thresholds) {
  const period = set.period || 'current'
  const comparisons = Array.isArray(set.comparisons) ? set.comparisons : []

  // NQ-3A/3B — Commentary Planning Layer. The deterministic plan (disposition /
  // materiality / theme / owner question per row) is computed FIRST, then the
  // owner-facing sections are SELECTED from it (NQ-3B). Sentence generation is
  // unchanged — each selected row is still rendered by the same toNote(), so
  // wording, figures, and ordering are identical for the existing sections.
  const plan = buildCommentaryPlan(comparisons, { thresholds })

  const executiveSummary = buildExecutiveSummary(comparisons, period, thresholds)
  const highVariances = buildHighVariances(comparisons, plan)
  const missingData = buildMissingData(comparisons)
  const revenueNotes = buildRevenueNotes(comparisons, plan)
  const expenseNotes = buildExpenseNotes(comparisons, plan)
  // Context Notes (NQ-3C, NEW) — the catch-all that re-homes every triggered,
  // non-rollup row the three sections above did not place (e.g. grouped timing/
  // non-cash expense lines), so no counted variance goes unnarrated. Omitted when
  // empty (see below).
  const contextNotes = buildContextNotes(comparisons, plan)
  // Review Items (NQ-3B) — rows the plan flags as needing a closer look
  // (ownerQuestion === WHAT_TO_CHECK). INERT in NQ-3C: computed for traceability
  // but no surface renders it. Omitted entirely when empty (see below).
  const reviewItems = buildReviewItems(comparisons, plan)
  // The complete variance table for the Excel export (Phase 21.6). Additive and
  // export-only — no owner-facing narrative section reads it, so Markdown/DOCX
  // and the on-screen summary stay byte-identical.
  const allVariances = buildAllVariances(comparisons)

  // Top-level traceability: every source row any sentence in this period drew on.
  const sourceRows = unionSourceRows([
    ...executiveSummary,
    ...highVariances,
    ...missingData,
    ...revenueNotes,
    ...expenseNotes,
    ...contextNotes,
    ...reviewItems
  ])

  return {
    period,
    periodLabel: periodLabel(period),
    executiveSummary,
    highVariances,
    missingData,
    revenueNotes,
    expenseNotes,
    // Context Notes renders after Expense Notes; omitted when empty so a period
    // with nothing left to re-home carries no empty section.
    ...(contextNotes.length > 0 ? { contextNotes } : {}),
    // Review Items is INERT (no surface renders it); kept on the object only when
    // present, for traceability/tooling. Omitted when empty.
    ...(reviewItems.length > 0 ? { reviewItems } : {}),
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
