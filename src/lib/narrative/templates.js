// --- Narrative templates — Phase 9A ---------------------------------------
// The fixed sentence shapes. These are the ONLY place narrative prose is
// authored. They are pure string builders: every value they interpolate is
// passed in already-formatted by the caller, so a template can never read a
// record, do math, or invent a figure. Owner tone — concise and plain.
//
// Examples (from spec):
//   Revenue favorable:   Revenue exceeded budget by $X (Y%) for the current period.
//   Expense unfavorable: Operating expense exceeded budget by $X (Y%) year-to-date.
//   Missing:             Budget comparison unavailable.

import {
  formatAbsMoney,
  formatAbsPercent,
  periodPhrase,
  comparisonBasis,
  capitalize
} from './formatters.js'

// Direction verb for a movement against its comparison basis. Sign of the
// variance amount picks the verb; the basis picks the noun. This is how
// favorable/unfavorable is respected in prose — an expense that "exceeded
// budget" reads as the unfavorable event it is, a revenue line that "exceeded
// budget" reads as the favorable one, with no value invented either way.
export function movementPhrase(comparisonType, varianceAmount) {
  const up = varianceAmount > 0
  if (comparisonType === 'prior') {
    return up ? 'rose above the prior period' : 'fell below the prior period'
  }
  return up ? 'exceeded budget' : 'came in under budget'
}

// "<Account> exceeded budget by $X (Y%) for the current period."
// The percentage clause is dropped entirely when percent is unavailable
// (e.g. a zero comparison base) rather than printed as a guessed value.
export function varianceSentence({ account, comparisonType, varianceAmount, variancePercent, period }) {
  const subject = account && account.trim() ? account.trim() : 'This line'
  const phrase = movementPhrase(comparisonType, varianceAmount)
  const amount = formatAbsMoney(varianceAmount)
  const pct = formatAbsPercent(variancePercent)
  const pctClause = pct ? ` (${pct})` : ''
  return `${subject} ${phrase} by ${amount}${pctClause} ${periodPhrase(period)}.`
}

// Describes exactly which side of the comparison is absent. Never assumes the
// missing value — it only reports that it could not be compared.
export function missingSentence({ account, hasActual, hasComparison, period }) {
  const subject = account && account.trim() ? `${account.trim()}: ` : ''
  let body
  if (!hasActual && !hasComparison) body = 'no actual or comparison figure available'
  else if (!hasActual) body = 'actual figure unavailable, so no variance was computed'
  else body = 'budget or prior comparison unavailable'
  return `${subject}${capitalize(body)} ${periodPhrase(period)}.`
}

// Executive summary lead line. Summarizes triggered totals and states the
// period context. Counts and totals are passed in; the template never sums.
export function executiveSentence({ period, count, total, favorable, unfavorable, thresholdAmount, thresholdPercent }) {
  const ctx = periodPhrase(period)
  if (count === 0) {
    return `${capitalize(ctx)}, no variances crossed the ${thresholdAmount} or ${thresholdPercent} thresholds.`
  }
  const noun = count === 1 ? 'variance' : 'variances'
  return (
    `${capitalize(ctx)}, ${count} ${noun} crossed the ${thresholdAmount} or ${thresholdPercent} ` +
    `thresholds, totaling ${total} in movement (${unfavorable} unfavorable, ${favorable} favorable).`
  )
}

// Optional second executive line splitting the triggered movement by side.
export function executiveSplitSentence({ revenueCount, expenseCount }) {
  if (revenueCount === 0 && expenseCount === 0) return null
  const parts = []
  if (revenueCount > 0) parts.push(`${revenueCount} revenue`)
  if (expenseCount > 0) parts.push(`${expenseCount} expense`)
  return `Of these, ${parts.join(' and ')} ${parts.length > 1 || revenueCount + expenseCount > 1 ? 'lines were' : 'line was'} flagged.`
}
