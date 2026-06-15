// --- Supporting-evidence wording — Phase 16 / 17 / 17.1 -------------------
// Owner-facing supporting-evidence language. Pure string builders: they read
// only the account label (from the BASE report, never a file name), the period,
// the supporting file's classification, and the deterministic GL-detail summary.
//
// Accounting rule (Phase 17.1): the COMPARATIVE REPORT determines the variance;
// GL / budget / supporting files provide CONTEXT ONLY. So no rendered phrase
// asserts or implies the evidence caused, drove, explains, or supports the
// variance. GL evidence renders as a STANDALONE evidence sentence; non-GL
// evidence remains a short, conservative clause merged into the variance line.
//
// Forbidden phrasings (never emitted): "primarily due to", "due to", "caused by",
// "driven by", "supporting the variance", "explains", "because of",
// "resulting from".
//
// Hard rules carried from Phase 16/17:
//   • Never render a file name, "Supporting file", or any debug/source language.
//   • Never invent or quote a figure from a supporting file (GL totals are real
//     sums of matched rows, rounded and flagged "approximately").
//   • Never say "current-period" for a year-to-date period.

import { normalizeName } from './match.js'

// A readable account label: strip a leading numeric code so
// "5100 Utility Expense Recovery" reads as "Utility Expense Recovery". Falls
// back to the original label if stripping would leave nothing.
export function displayAccount(account = '') {
  const stripped = String(account)
    .replace(/^\s*[0-9][0-9.\-]*\s*[·:.\-]?\s*/, '')
    .trim()
  return stripped || String(account).trim()
}

// The period phrase for an evidence sentence. YTD is always "year-to-date";
// the current/unknown period uses a "<prep> the [current] period" form. Never
// emits the hyphenated "current-period" used by older clause wording.
function periodSuffix(period, prep = 'during') {
  if (period === 'ytd') return 'year-to-date'
  if (period === 'current') return `${prep} the current period`
  return `${prep} the period`
}

// A small, deterministic lexicon mapping well-known account-name tokens to a
// friendly descriptor. Derived ONLY from the base account name (allowed); no
// hit drops the descriptor entirely rather than guessing. First match wins.
const DESCRIPTOR_LEXICON = [
  [/elect/i, 'electric'],
  [/water|sewer/i, 'water'],
  [/\bgas\b|natural\s*gas/i, 'gas'],
  [/insurance/i, 'insurance'],
  [/repair|mainten/i, 'repairs and maintenance'],
  [/utilit/i, 'utility'],
  [/payroll|salar|wage/i, 'payroll'],
  [/landscap/i, 'landscaping'],
  [/\btax(es)?\b/i, 'tax'],
  [/management|mgmt/i, 'management'],
  [/clean|janitor/i, 'cleaning'],
  [/legal/i, 'legal'],
  [/advertis|marketing/i, 'marketing'],
  [/\brent\b|rental/i, 'rental']
]

export function descriptorFor(account = '') {
  const a = String(account)
  for (const [re, word] of DESCRIPTOR_LEXICON) if (re.test(a)) return word
  return ''
}

// Round a GL total to a sensible "approximately" magnitude so it reads as an
// aggregate, never a fabricated exact figure: nearest 100 at/above $1,000, else
// nearest 10. Formatted with thousands separators and no decimals. Shared with
// the Excel export so the narrative and the workbook present totals identically.
export function approxMoney(total) {
  const abs = Math.abs(total)
  const step = abs >= 1000 ? 100 : 10
  const rounded = Math.round(abs / step) * step
  return `$${rounded.toLocaleString('en-US')}`
}

// Build the STANDALONE GL evidence sentence (Phase 17.1). It states what the GL
// contains — context only — and never asserts or implies causation. Always
// returns a full sentence (ending in a period) for a GL match. Tiers:
//   • reliable total → "GL detail shows approximately $X of related <type>
//     activity <period>."
//   • descriptions present (no reliable total) → "Related transactions appear in
//     detailed activity <period>."
//   • count only (amounts ambiguous, no descriptions) → "Detailed activity
//     includes N related transactions <period>."
//   • thin / name-only match → "Detailed account activity was available for
//     review."
export function glEvidenceSentence({ account, thick, detail, period } = {}) {
  if (!thick) return 'Detailed account activity was available for review.'

  const d = detail || {}
  const count = Number(d.count) || 0
  const totalReliable = typeof d.total === 'number' && Number.isFinite(d.total) && d.total !== 0

  if (totalReliable) {
    const descriptor = descriptorFor(account)
    const activity = descriptor ? `${descriptor} activity` : 'activity'
    return `GL detail shows approximately ${approxMoney(d.total)} of related ${activity} ${periodSuffix(period, 'during')}.`
  }
  if (d.topVendor) {
    return `Related transactions appear in detailed activity ${periodSuffix(period, 'for')}.`
  }
  if (count > 0) {
    const noun = count === 1 ? 'transaction' : 'transactions'
    return `Detailed activity includes ${count} related ${noun} ${periodSuffix(period, 'during')}.`
  }
  return 'Detailed account activity was available for review.'
}

// --- Phase 19A: classified GL commentary ----------------------------------
// Render the owner-facing GL sentence for a classifier category (see
// classify.js). Pure string builder: it reads only the category and the same
// deterministic GL-detail summary used elsewhere, plus the base account label
// for an optional friendly descriptor. It never renders a vendor string, a date,
// a reference/invoice ID, or a file name, and carries no causal language.
// Amounts are always passed through approxMoney() so a raw row figure is never
// re-quoted as an exact value.
export function commentarySentence({ type, account, detail, period, contribution } = {}) {
  const d = detail || {}
  const count = Number(d.count) || 0
  const total = d.total
  const reliableTotal = typeof total === 'number' && Number.isFinite(total) && total !== 0
  const maxTxn = typeof d.maxTxn === 'number' && Number.isFinite(d.maxTxn) ? Math.abs(d.maxTxn) : null
  const during = periodSuffix(period, 'during')

  // Phase 19B: contribution categories. These never render a single transaction
  // larger than the net total, and suppress the dollar entirely when the GL
  // activity is more than ~10× the variance (ratio > SUPPRESS_RATIO).
  const ratio = contribution && typeof contribution.ratio === 'number' ? contribution.ratio : null
  const suppress = ratio === null || ratio > 10

  switch (type) {
    case 'DC': // Direction conflict — GL net sign opposes the variance direction.
      if (suppress) {
        return `GL detail reflects a large net credit that runs counter to the variance direction and warrants review.`
      }
      return total < 0
        ? `GL detail shows a net credit of approximately ${approxMoney(Math.abs(total))} ${during}, which runs counter to the variance direction and warrants review.`
        : `GL detail shows net activity of approximately ${approxMoney(total)} ${during}, which runs counter to the variance direction and warrants review.`

    case 'OH': // Offset-heavy — a single line exceeds the net total; never show it.
      return suppress
        ? `GL detail reflects substantially larger related activity ${during}, including offsetting entries.`
        : `GL detail shows approximately ${approxMoney(total)} of related activity ${during}, including offsetting entries.`

    case 'DP': // Disproportionate — GL activity far larger than the variance.
      return suppress
        ? `GL detail reflects substantially larger related activity ${during}; only a portion is reflected in this variance.`
        : `GL detail shows approximately ${approxMoney(total)} of related activity ${during}, which is broader than this variance.`

    case 'PA': // Partial — GL activity far smaller than the variance.
      return `GL detail shows approximately ${approxMoney(total)} of related activity ${during}, a portion of the total movement.`
  }

  // Phase 19B: on an aligned, quantified shape, optionally embed a clean vendor
  // (replacing the descriptor) or append a clean short description. Mutually
  // exclusive (the contribution stage already cleared description when vendor
  // is renderable). Both are context only — never causal.
  const ALIGNED_QUANTIFIED = new Set(['A', 'B', 'C', 'I', 'F'])
  if (reliableTotal && contribution && ALIGNED_QUANTIFIED.has(type)) {
    if (contribution.vendorRenderable && d.vendor) {
      return `GL detail shows approximately ${approxMoney(total)} of related ${d.vendor} activity ${during}.`
    }
    if (contribution.descriptionRenderable && d.description) {
      const base = shapeSentence({ type, account, count, total, reliableTotal, maxTxn, during })
      return `${base.replace(/\.\s*$/, '')} (${d.description}).`
    }
  }

  return shapeSentence({ type, account, count, total, reliableTotal, maxTxn, during })
}

// The Phase 19A shape sentence (A–I). Factored out so Phase 19B can embed a
// vendor/description around it without duplicating the per-shape wording.
function shapeSentence({ type, account, count, total, reliableTotal, maxTxn, during }) {
  switch (type) {
    case 'A': // One-time
      return reliableTotal
        ? `GL detail shows a single transaction of approximately ${approxMoney(total)} ${during}.`
        : `GL detail shows a single related transaction ${during}.`

    case 'B': // One-time-dominated
      return (
        `GL detail shows approximately ${approxMoney(total)} across ${count} transactions, ` +
        `with one of about ${approxMoney(maxTxn)} ${during}.`
      )

    case 'C': // Recurring
      return `GL detail shows approximately ${approxMoney(total)} across ${count} recurring transactions ${during}.`

    case 'D': // Unbudgeted
      return reliableTotal
        ? `Activity occurred without a budget allocation; GL detail shows approximately ${approxMoney(total)} ${during}.`
        : 'Activity occurred without a budget allocation and should be reviewed for future forecasting.'

    case 'E': // Credit / true-up
      return count === 1
        ? `GL detail shows a single credit of approximately ${approxMoney(Math.abs(total))} ${during}.`
        : `GL detail shows net credits of approximately ${approxMoney(Math.abs(total))} across ${count} transactions ${during}.`

    case 'I': // Concentrated activity
      return `GL detail shows approximately ${approxMoney(total)} across two related transactions ${during}.`

    case 'G': // Low-confidence / thin
      return 'Detailed account activity was available for review.'

    case 'F': // Quantified fallback
    default: {
      if (!reliableTotal) {
        if (count > 0) {
          const noun = count === 1 ? 'transaction' : 'transactions'
          return `Detailed activity includes ${count} related ${noun} ${during}.`
        }
        return 'Detailed account activity was available for review.'
      }
      const descriptor = descriptorFor(account)
      const kind = descriptor ? `${descriptor} ` : ''
      if (count === 1) {
        return `GL detail shows approximately ${approxMoney(total)} of related ${kind}activity ${during}.`
      }
      return `GL detail shows approximately ${approxMoney(total)} across ${count} related ${kind}transactions ${during}.`
    }
  }
}

// Build a NON-GL supporting-evidence clause (no leading comma, no trailing
// period — the caller merges it into the variance sentence). GL evidence is NOT
// handled here; it renders as its own sentence via glEvidenceSentence. All
// wording is conservative context, with no causal language. Returns '' when no
// clause applies, leaving the variance sentence untouched.
export function explanationClause({ classificationType = '' } = {}) {
  const type = String(classificationType)

  // GL is rendered as a standalone sentence elsewhere — never a clause here.
  if (/general\s*ledger|\bgl\b/i.test(type)) return ''

  // Budget / forecast — context only, no causation.
  if (/budget|forecast/i.test(type)) {
    return 'compared against scheduled budget assumptions for the period'
  }
  // Prior-period detail — conservative, no causation.
  if (/prior|previous/i.test(type)) {
    return 'consistent with the prior-period detail provided'
  }
  // A matching variance schedule — conservative.
  if (/variance/i.test(type)) {
    return 'consistent with the supporting variance detail provided'
  }
  // Any other supporting document — conservative, owner-facing.
  return 'matched against detail in the source records'
}

// Re-export so callers can build an index/normalize without reaching into match.
export { normalizeName }
