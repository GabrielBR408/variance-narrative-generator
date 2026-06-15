// --- Supporting-evidence explanation text — Phase 16 ----------------------
// Owner-facing explanation CLAUSES that merge into the base variance sentence.
// Pure string builders: they read only the account label (from the BASE report,
// never a file name), the variance direction, the account type, the period, the
// supporting file's classification, and whether the evidence is "thick".
//
// Hard rules (Phase 16):
//   • Never render a file name, "Supporting file", or any debug/source language.
//   • Never invent or quote a figure from a supporting file.
//   • Never claim a cause unless GL evidence is thick (a real amount/description
//     was matched); thin evidence gets conservative "matching activity" wording.
//   • Never say "current-period" for a year-to-date period.
// The base sentence supplies the account, dollars, and percent; these clauses
// only explain — they read like a property manager wrote them.

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

// The period qualifier, only when it can be stated safely. An unknown period
// yields '' so we never assert a scope the narrative did not carry.
function periodWord(period) {
  if (period === 'current') return 'current-period'
  if (period === 'ytd') return 'year-to-date'
  return ''
}

// "higher" / "lower" from the signed variance amount. Matches the base sentence's
// own direction verb (e.g. "exceeded budget" ⇒ higher), so the clause never
// contradicts the figure it is appended to.
function directionWord(varianceAmount) {
  return (varianceAmount ?? 0) > 0 ? 'higher' : 'lower'
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

// The activity noun by account type: an expense "charge", revenue/other
// "activity". Keeps the clause grammatical regardless of descriptor.
function activityNoun(accountType) {
  return accountType === 'expense' ? 'charges' : 'activity'
}

// Join optional parts with single spaces, dropping empties.
function join(...parts) {
  return parts.filter(Boolean).join(' ')
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

// A short, owner-facing description of a vendor/description string: collapse
// whitespace and cap length so a long memo cannot bloat the sentence. Returns ''
// for anything that is empty or reads like a pure number/code.
function tidyVendor(text = '') {
  const t = String(text).replace(/\s+/g, ' ').trim()
  if (!t || /^[\s0-9.,$()%\-]+$/.test(t)) return ''
  return t.length > 40 ? `${t.slice(0, 39).trimEnd()}…` : t
}

// Build the optional GL-detail fragment that follows the GL clause, e.g.
// "including PG&E activity totaling approximately $17,400" or
// "including 3 matching entries totaling approximately $17,400". Returns '' when
// there is nothing reliable to add, so the base GL clause stands alone. Never
// invents a vendor or a figure — only summarizes what was deterministically
// matched, and omits the total when it could not be reliably parsed.
export function glDetailFragment(detail) {
  if (!detail || typeof detail !== 'object') return ''
  const count = Number(detail.count) || 0
  if (count <= 0) return ''

  // A vendor/description is only surfaced when it recurs (appears on more than
  // one matched row), so a single stray memo is never asserted as "the" vendor.
  const vendor = detail.topVendorCount > 1 ? tidyVendor(detail.topVendor) : ''
  const subject = vendor
    ? `${vendor} activity`
    : `${count} matching ${count === 1 ? 'entry' : 'entries'}`

  const totalIsReliable = typeof detail.total === 'number' && Number.isFinite(detail.total) && detail.total !== 0
  const totalClause = totalIsReliable ? ` totaling approximately ${approxMoney(detail.total)}` : ''

  return `including ${subject}${totalClause}`
}

// Build the owner-facing explanation CLAUSE (no leading comma, no trailing
// period — the caller merges it into the base sentence). Returns '' when no
// safe clause applies, leaving the base sentence untouched.
export function explanationClause({
  classificationType = '',
  accountType,
  varianceAmount,
  account,
  period,
  thick,
  detail
} = {}) {
  const type = String(classificationType)
  const pw = periodWord(period)

  // General Ledger — the only evidence that may phrase a cause, and only when
  // thick (a real amount/description was matched).
  if (/general\s*ledger|\bgl\b/i.test(type)) {
    if (thick) {
      const direction = directionWord(varianceAmount)
      const descriptor = descriptorFor(account)
      const noun = activityNoun(accountType)
      const base = join('primarily due to', direction, pw, descriptor, noun, 'shown in the GL detail')
      // Phase 17: append the deterministic GL-detail summary when available.
      const fragment = glDetailFragment(detail)
      return fragment ? `${base}, ${fragment}` : base
    }
    // Thin: a name match only — confirm the line is in the ledger, claim no cause.
    return 'with matching GL activity supporting the variance'
  }

  // Budget / forecast — never overstate causation from a plan.
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
  return 'supported by matching detail in the source records'
}

// Re-export so callers can build an index/normalize without reaching into match.
export { normalizeName }
