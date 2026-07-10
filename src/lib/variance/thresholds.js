// --- Variance thresholds — Phase 8 ----------------------------------------
// The single, central place where "what counts as a notable variance" lives.
// Phase 8 calculation reads these defaults; nothing here interprets, narrates,
// persists, or calls a model. Keeping the numbers in one module means a future
// phase can wire user controls to one import instead of hunting constants.

// Phase 8 defaults, per spec.
//   amount  — absolute dollar movement that flags a row
//   percent — absolute percentage movement that flags a row (a whole number,
//             e.g. 10 means 10%, matching `variancePercent` in calculate.js)
export const DEFAULT_THRESHOLDS = Object.freeze({
  amount: 1000,
  percent: 10
})

// A row is flagged when EITHER the dollar OR the percentage movement crosses
// its threshold (spec: amount OR percent). Missing inputs never trigger.
export function isTriggered(varianceAmount, variancePercent, thresholds = DEFAULT_THRESHOLDS) {
  const byAmount =
    typeof varianceAmount === 'number' &&
    Number.isFinite(varianceAmount) &&
    Math.abs(varianceAmount) >= thresholds.amount

  const byPercent =
    typeof variancePercent === 'number' &&
    Number.isFinite(variancePercent) &&
    Math.abs(variancePercent) >= thresholds.percent

  return byAmount || byPercent
}

// NQ-2C — the "effectively zero" floor (canonical home; the narrative layer
// re-exports it). A variance whose absolute dollar movement is below this floor
// may still cross the PERCENT threshold (a tiny base yields a huge percent on a
// sub-dollar move) but tells an owner nothing. The engine clears its trigger
// (see index.js) so the preview's flagged count, the executive summary, and the
// Excel status column all agree — previously the narrative suppressed these
// rows while summarize() still counted them, and the two surfaces disagreed.
export const ZERO_NOISE_DOLLAR = 1
export function isZeroNoiseVariance(c) {
  const v = c && c.varianceAmount
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < ZERO_NOISE_DOLLAR
}

// Map the UI's Variance-Detail settings ({ dollarThreshold, percentThreshold },
// which arrive as strings from the form) to engine thresholds ({ amount, percent }).
// Only finite, non-negative values are honored; anything else falls back to the
// central default FOR THAT FIELD. Number('') === 0, so a blanked threshold input
// must be treated as unset — not as a 0 threshold that would flag every
// computable row. Pure and deterministic so the live preview and the generate
// path can flag rows with the SAME numbers (Phase 22.1 preview fidelity).
function thresholdField(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback
  if (typeof value === 'string' && value.trim() === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export function thresholdsFromSettings(settings) {
  return {
    amount: thresholdField(settings?.dollarThreshold, DEFAULT_THRESHOLDS.amount),
    percent: thresholdField(settings?.percentThreshold, DEFAULT_THRESHOLDS.percent)
  }
}
