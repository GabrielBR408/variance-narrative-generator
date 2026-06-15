// --- Supporting-evidence citation text — Phase 15 -------------------------
// The fixed sentence shapes for a supporting-file citation. Pure string
// builders: they interpolate only the file name and the account label that were
// matched. They state that the supporting file CONTAINS MATCHING detail — never
// that it CAUSED the variance, and never a figure. Direction/causation is left
// entirely to the base variance sentence the citation is appended to.

import { normalizeName } from './match.js'

// A readable account label for the citation: strip a leading numeric code so
// "5100 Utility Expense Recovery" reads as "Utility Expense Recovery". Falls
// back to the original label if stripping would leave nothing.
export function displayAccount(account = '') {
  const stripped = String(account)
    .replace(/^\s*[0-9][0-9.\-]*\s*[·:.\-]?\s*/, '')
    .trim()
  return stripped || String(account).trim()
}

// Build the citation sentence, choosing wording by the supporting file's
// classification. All variants use safe "matching" language, no causal claims.
export function citationText({ fileName, classificationType = '', account }) {
  const acct = displayAccount(account)
  const file = `Supporting file "${fileName}"`
  const type = String(classificationType)

  if (/general\s*ledger|\bgl\b/i.test(type)) {
    return `${file} contains matching ledger activity for ${acct}.`
  }
  if (/budget|forecast/i.test(type)) {
    return `${file} includes budget detail matching ${acct}.`
  }
  if (/prior|previous/i.test(type)) {
    return `${file} contains prior-period detail for ${acct}.`
  }
  if (/variance/i.test(type)) {
    return `${file} contains a matching variance entry for ${acct}.`
  }
  return `${file} contains matching detail for ${acct}.`
}

// Re-export so callers can build an index/normalize without reaching into match.
export { normalizeName }
