// --- Base-file pre-generate gate (structural, deterministic) ----------------
// Hard structural check that runs BEFORE computeVariance / enrichNarrative: if
// the base file does not carry the columns a comparative variance report has —
// an Actual column AND at least one of Budget or Prior — generation stops with a
// clear, actionable message. The bug it prevents is a misrouted base (a budget
// or a GL in the base slot) silently producing a "0 variances" result.
//
// Why this is the right level of check:
//   • detectComparisonSets is the same scorer computeVariance already runs to
//     decide whether a period is comparable; when it finds zero comparable sets,
//     computeVariance returns empty(reason:'no-comparable-columns') with nothing
//     for the narrative to say. That is precisely the silent failure mode the
//     gate replaces with an explicit STOP.
//   • The gate works on `normalized.columns` / `normalized.rows`, which is what
//     the routing point has — the raw-line `detectVarianceReport` cannot be
//     called there (the server never sees raw PDF lines).
//
// Pure & deterministic. NO LLM, NO network, NO variance math beyond column
// detection. Reused by the /api/generate server path AND the static-host
// clientGenerate fallback, so one rule gates both.

import { detectComparisonSets } from './detectColumns.js'

// The single, actionable owner-facing message. Worded so the next step is clear
// (replace the base; supporting files like a budget/GL can be added alongside).
export const BASE_GATE_MESSAGE =
  "The uploaded base file doesn't look like a comparative variance report " +
  '(no Actual vs Budget columns found). Please upload a comparative income ' +
  'statement as the base file. Supporting files like budgets and GL detail ' +
  'can be added alongside it.'

// Distinct reason codes (testable, exportable). Surface-only — never affects
// variance math when the gate passes.
export const BASE_GATE_OK = 'ok'
export const BASE_GATE_NO_COLUMNS = 'no-columns' // not tabular at all
export const BASE_GATE_NO_COMPARISON = 'no-comparable-columns' // headers don't read as Actual + Budget/Prior

// Inspect a base extraction's normalized shape. Returns
//   { ok: true,  reason: 'ok',  message: '' }                     — gate passes
//   { ok: false, reason, message: BASE_GATE_MESSAGE }              — gate fails
//
// Gate fails when there are no columns, OR when detectComparisonSets finds no
// set that has Actual AND (Budget OR Prior). All other shapes pass — the gate is
// strictly about "could computeVariance produce a comparable set?".
export function checkBaseIsVarianceReport(normalized) {
  const columns = normalized && Array.isArray(normalized.columns) ? normalized.columns : []
  const rows = normalized && Array.isArray(normalized.rows) ? normalized.rows : []

  if (columns.length === 0) {
    return { ok: false, reason: BASE_GATE_NO_COLUMNS, message: BASE_GATE_MESSAGE }
  }

  const { sets } = detectComparisonSets(columns, rows)
  const comparable = Array.isArray(sets)
    ? sets.some((s) => s && s.columns && s.columns.actual !== null && (s.columns.budget !== null || s.columns.prior !== null))
    : false

  if (!comparable) {
    return { ok: false, reason: BASE_GATE_NO_COMPARISON, message: BASE_GATE_MESSAGE }
  }

  return { ok: true, reason: BASE_GATE_OK, message: '' }
}
