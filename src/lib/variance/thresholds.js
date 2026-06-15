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
