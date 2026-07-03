// --- Narrative preview routing — Phase 21.5 -------------------------------
// Mirrors the generate path so the live Narrative Preview shows exactly ONE
// narrative: the Base Variance Report's, enriched with every supporting file —
// instead of computing a standalone narrative per uploaded file.
//
// This is the same deterministic route the generate flow runs:
//   computeVariance(base) → generateNarrative(base)
//     → enrichNarrative(baseNarrative, { supporting }) → scopeNarrative
//
// A supporting file (GL, budget, prior, …) therefore NEVER produces its own
// preview narrative; it only contributes evidence to the base narrative. With no
// Base Variance Report, there is no preview (null), matching the generate gate.
//
// PURE: no AI/LLM, no network, no persistence. It only READS the already-computed
// extractions and runs the same in-memory engines the rest of the app uses.

import { computeVariance } from './variance/index.js'
import { DEFAULT_THRESHOLDS, thresholdsFromSettings } from './variance/thresholds.js'
import { generateNarrative } from './narrative/index.js'
import { enrichNarrative } from './enrich/index.js'
import { scopeNarrative, DEFAULT_PERIOD_SCOPE } from './narrative/periodScope.js'
import { applyDollarAbbreviation } from './narrative/dollarAbbrev.js'

// The classification an uploaded file carries when it sits in the base slot
// (see src/lib/classify.js — role 'baseReport' wins outright). This is the only
// signal that distinguishes the base report from supporting evidence.
export const BASE_TYPE = 'Base Variance Report'

// Find the Base Variance Report among the OK extractions, or null when none has
// been uploaded yet.
export function findBaseExtraction(items = []) {
  const ok = (Array.isArray(items) ? items : []).filter((ex) => ex && ex.status === 'ok')
  return ok.find((ex) => ex.classification && ex.classification.type === BASE_TYPE) || null
}

// Split the OK extractions into the single base report and its supporting files.
// Centralizes the base-vs-supporting rule so every preview surface agrees on
// which file drives the variance and which files only enrich it.
function splitBaseSupporting(items = []) {
  const ok = (Array.isArray(items) ? items : []).filter((ex) => ex && ex.status === 'ok')
  const base = findBaseExtraction(ok)
  const supporting = ok.filter((ex) => ex !== base)
  return { ok, base, supporting }
}

// Build the single preview narrative from the uploaded extractions. Returns the
// scoped, enriched base narrative, or null when there is no base or the base
// produced no comparable period. Same inputs always yield the same result.
//
// Phase 22.1: `thresholds` is threaded through so the live preview flags rows
// with the user's CURRENT thresholds — the same numbers the generate path uses —
// instead of a hardcoded default. Defaults to the central thresholds for
// backward compatibility.
//
// `style` mirrors the generate path's cosmetic pass (useGenerate.js): when the
// "Abbreviate Dollar Values" toggle is on, the preview shows the same "$5K"
// figures the generated result will. Absent/off → identity, so the preview is
// byte-identical to before.
export function buildPreviewNarrative({
  items = [],
  periodScope = DEFAULT_PERIOD_SCOPE,
  commentaryMode = 'conservative',
  thresholds = DEFAULT_THRESHOLDS,
  style = null
} = {}) {
  const { base, supporting } = splitBaseSupporting(items)
  if (!base) return null

  const variance = computeVariance(base, thresholds)
  const baseNarrative = generateNarrative(variance)
  const enriched = enrichNarrative(baseNarrative, { supporting, mode: commentaryMode })
  const scoped = scopeNarrative(enriched, periodScope)

  // Only surface when the base actually produced at least one comparable period.
  if (!scoped || !Array.isArray(scoped.periods) || scoped.periods.length === 0) return null
  return applyDollarAbbreviation(scoped, !!(style && style.abbreviateDollars))
}

// Resolve what the Narrative Preview should show (Phase 22.3). Distinguishes an
// explicit EMPTY state — a base report extracted cleanly but produced no
// comparable period (no Actual vs Budget/Prior columns) — from simply having no
// base yet, so the UI never renders a silent null when there IS a base to explain.
//   kind: 'narrative' (render it) | 'empty' (base ok, nothing comparable) | 'none'
//
// "Comparable" is judged from the variance result, not from the narrative: an
// uncomparable base still yields a degenerate single-period narrative, so the
// presence of at least one computed comparison row is the honest signal.
export function previewNarrativeState({
  items = [],
  periodScope = DEFAULT_PERIOD_SCOPE,
  commentaryMode = 'conservative',
  thresholds = DEFAULT_THRESHOLDS,
  style = null
} = {}) {
  const base = findBaseExtraction(items)
  if (!base) return { kind: 'none', narrative: null }

  const variance = computeVariance(base, thresholds)
  const comparable =
    (Array.isArray(variance.comparisonSets) && variance.comparisonSets.length > 0) ||
    (Array.isArray(variance.comparisons) && variance.comparisons.length > 0)
  if (!comparable) return { kind: 'empty', narrative: null }

  const narrative = buildPreviewNarrative({ items, periodScope, commentaryMode, thresholds, style })
  if (!narrative) return { kind: 'empty', narrative: null }
  return { kind: 'narrative', narrative }
}

// Build the BASE-ONLY variance preview (Phase 22.1). Variance is computed solely
// for the Base Variance Report; supporting files (GL / Budget / Prior / …) are
// returned untouched and visible, but are NEVER variance-computed — so the UI
// can never present a supporting file as a variance driver. Uses the exact same
// `computeVariance(base, thresholds)` the generate pipeline runs, guaranteeing
// the previewed rows match the generated rows 1:1 at the same thresholds.
export function buildVariancePreview({ items = [], thresholds = DEFAULT_THRESHOLDS } = {}) {
  const { base, supporting } = splitBaseSupporting(items)
  return {
    base: base ? { extraction: base, variance: computeVariance(base, thresholds) } : null,
    supporting
  }
}

// A tiny, deterministic causality model for the preview header: which single
// file drives the variance (the base report) and which files only enrich it.
// Pure data so the indicator's wording is testable and can never drift from the
// base-only routing above.
export function previewBasis({ items = [] } = {}) {
  const { base, supporting } = splitBaseSupporting(items)
  const hasBase = !!base
  const supportingNames = supporting.map((ex) => ex.fileName).filter(Boolean)
  return {
    hasBase,
    baseName: hasBase ? base.fileName || null : null,
    supportingCount: supporting.length,
    supportingNames,
    summary: hasBase
      ? 'Variance is computed from the base report only. Supporting files enrich the narrative.'
      : 'Add a base report to compute variances. Supporting files only enrich the narrative.'
  }
}

// Re-exported for callers that resolve UI settings into engine thresholds.
export { thresholdsFromSettings }
