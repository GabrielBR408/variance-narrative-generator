// --- Period-scope view filter — Phase 15.1 --------------------------------
// Deterministic, pure narrowing of a generated narrative to a user-selected
// reporting-period scope. A base variance report that lays a Current and a
// Year-to-Date comparison side by side produces TWO narrative periods (see
// src/lib/variance/detectColumns.js); this lets the owner choose which to read
// and export.
//
// Pure and side-effect free: NO AI/LLM, NO new math (it only SELECTS among
// periods the variance/narrative engines already produced — it never re-sums or
// invents a figure), NO network, NO persistence, NO server.
//
// Identity invariant: when the requested scope changes nothing — the default
// 'both', an unknown value, or a narrative that does not actually carry both a
// Current and a YTD period — the SAME narrative reference is returned. So
// existing/base-only output stays byte-identical and the Phase 15 enrichment it
// wraps is left completely untouched.
//
// Input shape (from src/lib/narrative/generateNarrative.js, optionally enriched):
//   { fileId, fileName, classification, thresholds, periods: [
//       { period, periodLabel, executiveSummary, highVariances, missingData,
//         revenueNotes, expenseNotes, sourceRows }, ... ] }

// Scopes with implemented behavior. 'combined' is intentionally NOT here yet
// (it needs period-labeled prose composition — surfaced in the UI as a disabled
// "Coming Soon" option only, with no behavior).
export const PERIOD_SCOPES = ['both', 'current', 'ytd']
export const DEFAULT_PERIOD_SCOPE = 'both'

// --- UI presentation (single source of truth for the selector) -------------
// The control's label, ordered options, and helper text live here so the
// rendered wording is testable as data and can never drift from behavior.
export const PERIOD_SCOPE_LABEL = 'Variance Explanation Scope'

export const PERIOD_SCOPE_OPTIONS = [
  { value: 'current', label: 'Current Period' },
  { value: 'ytd', label: 'Year-to-Date' },
  { value: 'both', label: 'Separate (Current + YTD)' },
  // UI-only: Combined is shown but disabled until its logic ships.
  { value: 'combined', label: 'Combined (Coming Soon)', disabled: true }
]

export const PERIOD_SCOPE_HELP =
  'Separate shows Current and YTD independently. Combined will merge duplicate ' +
  'account explanations across periods in a future release.'

function periodsOf(narrative) {
  return Array.isArray(narrative?.periods) ? narrative.periods : []
}

// The distinct period keys present on a narrative, e.g. ['current', 'ytd'].
export function periodKeys(narrative) {
  return periodsOf(narrative).map((p) => p && p.period)
}

// Does the narrative carry BOTH a Current and a YTD period? This is the only
// condition under which the period-scope control is shown/enabled; with a single
// period there is nothing to choose between, so current behavior is preserved.
export function hasBothPeriods(narrative) {
  const keys = new Set(periodKeys(narrative))
  return keys.has('current') && keys.has('ytd')
}

// Read more naturally at the call site that gates the UI control.
export function periodScopeAvailable(narrative) {
  return hasBothPeriods(narrative)
}

// Narrow a narrative to the selected period scope. Returns the SAME reference
// when the scope changes nothing (default/unknown scope, or a narrative without
// both periods), preserving byte-identical output and current behavior.
export function scopeNarrative(narrative, scope = DEFAULT_PERIOD_SCOPE) {
  if (!periodScopeAvailable(narrative)) return narrative
  if (scope === 'current' || scope === 'ytd') {
    return { ...narrative, periods: periodsOf(narrative).filter((p) => p.period === scope) }
  }
  // 'both' / default / unknown → unchanged (both periods, exactly as today).
  return narrative
}
