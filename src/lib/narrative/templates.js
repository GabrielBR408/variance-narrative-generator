// --- Narrative templates — Phase 9A / 14 ----------------------------------
// The fixed sentence shapes. These are the ONLY place narrative prose is
// authored. They are pure string builders: every value they interpolate is
// passed in already-formatted by the caller, so a template can never read a
// record, do math, or invent a figure. Owner tone — concise and plain.
//
// Phase 14 (narrative quality): the period (Current / YTD) is already carried
// by the section heading and stated once in the executive summary, so the line
// notes no longer repeat "for the current period" / "year-to-date" on every
// bullet. Every dollar and percent figure is preserved; only the redundant
// trailing period clause is dropped, keeping the lines tight and owner-ready.
//
// Examples:
//   Revenue favorable:   Revenue exceeded budget by $X (Y%).
//   Expense unfavorable: Operating expense exceeded budget by $X (Y%).
//   Missing:             Budget or prior comparison unavailable.

import {
  formatAbsMoney,
  formatAbsPercent,
  periodPhrase,
  capitalize,
  displayAccountLabel
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

// "<Account> exceeded budget by $X (Y%)."
// The percentage clause is dropped entirely when percent is unavailable
// (e.g. a zero comparison base) rather than printed as a guessed value. The
// period is not repeated here — it is carried by the section heading.
export function varianceSentence({ account, comparisonType, varianceAmount, variancePercent }) {
  // Owner prose strips the leading account code; the coded label is retained on
  // the note metadata (Phase 20A.1).
  const display = displayAccountLabel(account)
  const subject = display ? display : 'This line'
  const phrase = movementPhrase(comparisonType, varianceAmount)
  const amount = formatAbsMoney(varianceAmount)
  const pct = formatAbsPercent(variancePercent)
  const pctClause = pct ? ` (${pct})` : ''
  return `${subject} ${phrase} by ${amount}${pctClause}.`
}

// Describes exactly which side of the comparison is absent. Never assumes the
// missing value — it only reports that it could not be compared. Like the
// variance line, it inherits its period from the section heading.
export function missingSentence({ account, hasActual, hasComparison }) {
  const display = displayAccountLabel(account)
  const subject = display ? `${display}: ` : ''
  let body
  if (!hasActual && !hasComparison) body = 'no actual or comparison figure available'
  else if (!hasActual) body = 'actual figure unavailable, so no variance was computed'
  else body = 'budget or prior comparison unavailable'
  return `${subject}${capitalize(body)}.`
}

// Executive summary line — a single owner-ready sentence that states the period
// once, the count and total movement, and the favorable/unfavorable split. The
// revenue/expense breakdown is intentionally left to the dedicated Revenue and
// Expense Notes sections rather than repeated here. Counts and totals are passed
// in already computed; the template never sums.
export function executiveSentence({ period, count, total, favorable, unfavorable, thresholdAmount, thresholdPercent }) {
  const ctx = periodPhrase(period)
  if (count === 0) {
    return `${capitalize(ctx)}, no variances crossed the ${thresholdAmount} or ${thresholdPercent} thresholds.`
  }
  const noun = count === 1 ? 'variance' : 'variances'
  return (
    `${capitalize(ctx)}, ${count} ${noun} totaling ${total} crossed the ` +
    `${thresholdAmount} or ${thresholdPercent} thresholds (${unfavorable} unfavorable, ${favorable} favorable).`
  )
}
