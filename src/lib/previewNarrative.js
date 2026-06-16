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
import { DEFAULT_THRESHOLDS } from './variance/thresholds.js'
import { generateNarrative } from './narrative/index.js'
import { enrichNarrative } from './enrich/index.js'
import { scopeNarrative, DEFAULT_PERIOD_SCOPE } from './narrative/periodScope.js'

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

// Build the single preview narrative from the uploaded extractions. Returns the
// scoped, enriched base narrative, or null when there is no base or the base
// produced no comparable period. Same inputs always yield the same result.
export function buildPreviewNarrative({
  items = [],
  periodScope = DEFAULT_PERIOD_SCOPE,
  commentaryMode = 'conservative'
} = {}) {
  const ok = (Array.isArray(items) ? items : []).filter((ex) => ex && ex.status === 'ok')
  const base = findBaseExtraction(ok)
  if (!base) return null

  // Every other OK file is supporting evidence — exactly what the generate flow
  // hands to enrichNarrative.
  const supporting = ok.filter((ex) => ex !== base)

  const variance = computeVariance(base, DEFAULT_THRESHOLDS)
  const baseNarrative = generateNarrative(variance)
  const enriched = enrichNarrative(baseNarrative, { supporting, mode: commentaryMode })
  const scoped = scopeNarrative(enriched, periodScope)

  // Only surface when the base actually produced at least one comparable period.
  if (!scoped || !Array.isArray(scoped.periods) || scoped.periods.length === 0) return null
  return scoped
}
