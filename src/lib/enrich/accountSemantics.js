// --- Account semantics — NQ-2C --------------------------------------------
// Lightweight, deterministic recognition of special account TYPES from the base
// account NAME (never a file name, never a figure). For these accounts a generic
// operating-expense or revenue-performance explanation is misleading, so detailed
// mode substitutes cautious, type-appropriate wording in place of the generic GL
// fallback.
//
// Pure and deterministic: it reads only the account label and returns a single
// fixed sentence (or null). It performs NO extraction, NO matching, NO variance
// math, NO AI/LLM. It carries no causal or certainty language, and emits at most
// ONE sentence so the two-sentence-per-note rule holds (S1 base + S2 here).
//
// Three families, matched most-specific first (first hit wins):
//   • NON_CASH  — Depreciation / Amortization (a schedule item, not cash spend).
//   • RECOVERY  — Utility / CAM / Insurance / Tax Recovery (tenant recoveries,
//                 driven by billing / recovery timing, not operating performance).
//   • TIMING    — Prepaid / Accrued / Deferred / Clearing / Suspense / A/R
//                 (balance-sheet / classification items, not operating results).

// Non-cash schedule accounts.
const NON_CASH_RE = /\b(depreciation|amortization|amortisation|amortized|amortised|depreciat\w*)\b/i

// Tenant / expense recoveries (Utility Expense Recovery, CAM Recovery, …).
const RECOVERY_RE = /\brecover(y|ies|able)\b/i

// Timing / balance-sheet / classification accounts. "A/R" is matched as a whole
// token so it never fires inside an unrelated word.
const TIMING_RE =
  /(\bprepaid\b|\baccru(e|ed|al|als)\b|\bdeferred\b|\bdeferral\b|\bclearing\b|\bsuspense\b|\baccounts?\s+receivable\b|(^|[^a-z])a\/r([^a-z]|$))/i

// The cautious S2 wording per family. Each is a single sentence with no causal or
// certainty language. The two preferred phrasings from the spec are folded into
// one sentence so the note stays at two sentences total.
export const ACCOUNT_SEMANTIC = {
  NON_CASH:
    'This is a non-cash expense variance and should be reviewed against the depreciation/amortization schedule.',
  RECOVERY:
    'Recovery variance appears tied to billing or recovery timing and should be reviewed against recoverable expense billing and tenant recovery assumptions.',
  TIMING:
    'This appears to be a timing or balance-sheet related variance and should be reviewed as a timing/classification item rather than operating performance.'
}

// Classify an account label into one of the semantic families, or null.
export function accountSemanticType(account = '') {
  const a = String(account)
  if (NON_CASH_RE.test(a)) return 'NON_CASH'
  if (RECOVERY_RE.test(a)) return 'RECOVERY'
  if (TIMING_RE.test(a)) return 'TIMING'
  return null
}

// The cautious S2 sentence for a note's account, or null when no family matches.
export function accountSemanticCommentary(note = {}) {
  const type = accountSemanticType(note && note.account)
  return type ? ACCOUNT_SEMANTIC[type] : null
}
