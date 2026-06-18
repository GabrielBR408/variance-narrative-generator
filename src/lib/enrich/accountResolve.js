// --- Deterministic account resolution — NQ-4C.1 ----------------------------
// Connects an owner-facing base variance line (e.g. "HVAC Contract") to a GL
// bookkeeping account label (e.g. "Repairs & Maintenance - HVAC") that the
// existing exact / substring tiers in match.js miss. Pure and deterministic:
// NO AI/LLM, NO network, NO aliases, NO fuzzy edit-distance — just significant-
// token set logic with explicit guardrails, so a real owner line resolves while
// near-miss accounts (different equipment, contra/balance-sheet accounts) do NOT.
//
// Architecture: match.js stays the scoring authority. It calls resolveScore as a
// NEW tier AFTER its exact-code / exact-name / substring tiers and BEFORE the
// sub-floor token-overlap fallback, so every existing citation is unchanged and
// only previously-unmatched pairs can newly resolve.
//
// Scoring (capped at 0.85 — a resolved match is never as certain as an exact one,
// and stays below the 0.90 vendor-render gate so a fuzzy match never names a
// vendor):
//   resolved_equal   significant(base) == significant(entry)        → 0.85
//   resolved_subset  significant(base) ⊂ significant(entry), guarded → 0.75
//
// Guardrails (reject → score 0):
//   • stripping qualifiers leaves zero significant tokens (base or entry)
//   • a significant base token is absent from the entry (not a subset)
//   • Jaccard(significant sets) < 0.5 (rejects single-token dilution, e.g.
//     "Electric" vs "Electric Vehicle Charging")
//   • the entry introduces a DISQUALIFYING token the base lacks (contra /
//     balance-sheet signal, e.g. "Real Estate Tax" vs "…Tax Refund")

import { normalizeName, tokensOf } from './match.js'

export const RESOLVED_EQUAL_SCORE = 0.85
export const RESOLVED_SUBSET_SCORE = 0.75
export const RESOLVE_JACCARD_MIN = 0.5

// Filler / roll-up words that carry no account-identity signal. Stripped to
// derive the SIGNIFICANT tokens used for resolution only — normalizeName itself
// is untouched, so the exact/substring tiers keep their current behavior.
// "R&M" normalizes to the tokens "r" and "m", so both are listed.
export const QUALIFIER_TOKENS = new Set([
  'contract', 'contracts', 'maintenance', 'repair', 'repairs', 'r', 'm', 'rm',
  'expense', 'expenses', 'service', 'services', 'other', 'supplies', 'supply',
  'fee', 'fees', 'cost', 'costs', 'misc', 'miscellaneous', 'general', 'total',
  'account', 'acct'
])

// Tokens that, when present in the ENTRY but not the base, flag a different
// account kind (contra / balance-sheet / clearing) — never the operating line
// the base refers to. Deliberately does NOT include "recovery": an expense
// recovery (e.g. "Utility Expense Recovery") is a real operating line.
export const DISQUALIFYING_TOKENS = new Set([
  'refund', 'refunds', 'receivable', 'receivables', 'payable', 'payables',
  'reserve', 'reserves', 'deposit', 'deposits', 'prepaid', 'accrued', 'accrual',
  'escrow', 'claim', 'claims', 'suspense', 'clearing', 'allowance'
])

// The significant tokens of a label: normalize (shared with match.js, so leading
// codes/punctuation are handled identically), then drop qualifier words.
export function significantTokens(label = '') {
  return tokensOf(normalizeName(label)).filter((t) => !QUALIFIER_TOKENS.has(t))
}

// The significant tokens of an already-indexed entry, reusing its precomputed
// normalized tokens (entry.tokens === tokensOf(entry.normName)).
function significantEntryTokens(entry) {
  const toks = Array.isArray(entry && entry.tokens) ? entry.tokens : []
  return toks.filter((t) => !QUALIFIER_TOKENS.has(t))
}

// Resolve one base account against one index entry. Returns { score, method }:
//   { 0.85, 'resolved_equal' } | { 0.75, 'resolved_subset' } | { 0, null }
export function resolveScore(baseAccount, entry) {
  const sb = significantTokens(baseAccount)
  const se = significantEntryTokens(entry)
  // All-qualifier guard: nothing meaningful left to resolve on either side.
  if (sb.length === 0 || se.length === 0) return { score: 0, method: null }

  const setB = new Set(sb)
  const setE = new Set(se)

  // Subset guard: every significant base token must appear in the entry.
  for (const t of setB) if (!setE.has(t)) return { score: 0, method: null }

  // Disqualifying-token guard: an entry-only token signalling a different kind
  // of account (refund / receivable / reserve / …) rejects the resolution.
  for (const t of setE) {
    if (!setB.has(t) && DISQUALIFYING_TOKENS.has(t)) return { score: 0, method: null }
  }

  // Jaccard guard: reject dilution by many extra meaningful tokens.
  let inter = 0
  for (const t of setB) if (setE.has(t)) inter++
  const union = new Set([...setB, ...setE]).size
  const jaccard = union ? inter / union : 0
  if (jaccard < RESOLVE_JACCARD_MIN) return { score: 0, method: null }

  // Subset already holds, so equal sets ⇔ equal size.
  return setB.size === setE.size
    ? { score: RESOLVED_EQUAL_SCORE, method: 'resolved_equal' }
    : { score: RESOLVED_SUBSET_SCORE, method: 'resolved_subset' }
}
