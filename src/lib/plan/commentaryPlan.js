// --- Commentary Planning Layer — NQ-3A (foundation, INERT) -----------------
// Builds a deterministic PLAN for a single comparison set BEFORE any sentence is
// rendered. The plan moves the "what should we say, and how prominently" decisions
// out of the rendering code and into an inspectable data object that LATER phases
// (NQ-3B+) will consume.
//
// NQ-3A is deliberately INERT: `buildPeriodNarrative` attaches the plan to the
// period object, but NOTHING reads it. No section, export, preview, or enrichment
// consults `period.plan`, so every owner-visible byte stays identical to today.
// This file only describes decisions the renderer already makes implicitly today;
// it changes none of them.
//
// Pure and deterministic: the same comparisons always yield the same plan. It
// performs NO extraction, NO matching, NO variance math (it only READS figures the
// variance engine already computed), NO AI/LLM, NO network, NO persistence.
//
// Reuse over reinvention: disposition and materiality are derived from the SAME
// helpers the sections renderer uses (triggeredRows / headlineSet / byMateriality /
// isCategoryOwned / isRollupLabel / isZeroNoiseVariance), and theme detection
// reuses the existing account-semantic families. So the plan can never silently
// drift from the rendering rules it describes.

import {
  byMateriality,
  triggeredRows,
  headlineSet,
  isCategoryOwned,
  isRollupLabel,
  isZeroNoiseVariance
} from '../narrative/sections.js'
import { isImmaterialVariance } from '../enrich/commentaryIntent.js'
import { accountSemanticType } from '../enrich/accountSemantics.js'

// --- Theme detection -------------------------------------------------------
// Business-theme families. The three special account-semantic families
// (non-cash / recovery / timing) are reused verbatim from accountSemantics so the
// plan and the existing NQ-2C wording always agree; the operating families below
// EXTEND that set. Detection is deterministic, word-boundary only, and ordered
// most-specific first (first hit wins). It reads ONLY the account label.

const TAXES_RE = /\btax(es)?\b/i
const UTILITIES_RE = /\b(utilities|utility|electric(ity)?|water|sewer|gas|power|energy)\b/i
const SECURITY_RE = /\b(security|surveillance|alarm|guard|life\s*safety|fire\s*safety|fire\s*alarm)\b/i
const JANITORIAL_RE = /\b(janitor(ial)?|cleaning|custodial|porter)\b/i
const REPAIRS_RE = /\b(repairs?|maintenance|hvac|plumbing|landscap(e|ing)|grounds)\b/i
const REVENUE_LEASING_RE = /\b(rent|rental|lease|leasing|occupancy|tenant)\b/i

// Operating expense themes — used by the owner-question rule below.
const OPERATING_THEMES = new Set(['utilities', 'security', 'janitorial', 'repairs'])

// Classify an account into ONE business theme. Account-semantic families are
// checked first so e.g. "Tax Recovery" reads as a recovery and "Prepaid Taxes" as
// a timing item, never as plain taxes.
export function themeOf(account = '', accountType) {
  const semantic = accountSemanticType(account)
  if (semantic === 'NON_CASH') return 'non_cash'
  if (semantic === 'RECOVERY') return 'recoveries'
  if (semantic === 'TIMING') return 'timing_balance_sheet'

  const a = String(account)
  if (TAXES_RE.test(a)) return 'taxes'
  if (UTILITIES_RE.test(a)) return 'utilities'
  if (SECURITY_RE.test(a)) return 'security'
  if (JANITORIAL_RE.test(a)) return 'janitorial'
  if (REPAIRS_RE.test(a)) return 'repairs'
  if (REVENUE_LEASING_RE.test(a)) return 'revenue_leasing'
  if (accountType === 'revenue') return 'revenue_leasing'
  return 'other'
}

// --- Disposition -----------------------------------------------------------
// Where a row lands in the owner narrative TODAY, expressed as a single label.
// Derived from the exact predicates the renderer uses so it mirrors current
// behavior precisely:
//   rollup      — a statement subtotal/total (never narrated; isRollupLabel)
//   suppressed  — below threshold, or sub-$1 "zero noise" (not in triggeredRows)
//   individual  — surfaces in High Variances (headline driver, or untyped row)
//   grouped     — a triggered revenue/expense line deferred to its category note
function dispositionOf(c, headline) {
  if (isRollupLabel(c.account)) return 'rollup'
  const triggered = !!c.thresholdTriggered && !isZeroNoiseVariance(c)
  if (!triggered) return 'suppressed'
  if (headline.has(c) || !isCategoryOwned(c)) return 'individual'
  return 'grouped'
}

// Why a suppressed row was held back (null for non-suppressed rows). Mirrors the
// existing suppression rules — it invents no new reason.
function suppressReasonOf(c, disposition) {
  if (disposition !== 'suppressed') return null
  if (isZeroNoiseVariance(c)) return 'zero_noise'
  if (!c.thresholdTriggered) return 'below_threshold'
  return null
}

// --- Materiality -----------------------------------------------------------
// Reuses the renderer's own bands: sub-$1 is "noise", a headline driver is a
// "top_driver", an operationally-trivial line is "immaterial", everything else is
// "material". Checked noise-first because a zero-noise row is also immaterial.
function materialityOf(c, headline) {
  if (isZeroNoiseVariance(c)) return 'noise'
  if (headline.has(c)) return 'top_driver'
  if (isImmaterialVariance(c)) return 'immaterial'
  return 'material'
}

// --- Evidence + owner question ---------------------------------------------
// `evidenceAvailable` is the INERT NQ-3A proxy: an account whose label maps to a
// recognized semantic family carries built-in explanatory evidence. GL/supporting
// evidence is NOT consulted at this stage (the plan runs inside base narrative
// generation, before enrichment) — later phases will enrich this signal.
function evidenceAvailableOf(account) {
  return accountSemanticType(account) !== null
}

// The single owner question this line most needs answered. Deterministic and
// ordered:
//   timing / balance-sheet            → DOES_IT_MATTER (is it real performance?)
//   utilities / recurring operating   → WHY (a known operating cost moved)
//   large + no explanatory evidence   → WHAT_TO_CHECK (material, unexplained)
//   fallback                          → WHAT_HAPPENED
function ownerQuestionOf({ theme, materiality, evidenceAvailable }) {
  if (theme === 'timing_balance_sheet') return 'DOES_IT_MATTER'
  if (OPERATING_THEMES.has(theme)) return 'WHY'
  const large = materiality === 'material' || materiality === 'top_driver'
  if (large && !evidenceAvailable) return 'WHAT_TO_CHECK'
  return 'WHAT_HAPPENED'
}

// A stable identifier for a row: its account label plus its first source-row
// index. Falls back to the array index when a row carries no source rows, so the
// id is always defined and unique within a plan.
function idOf(c, index) {
  const account = String(c.account || '').trim()
  const firstRow = Array.isArray(c.sourceRows) && c.sourceRows.length > 0 ? c.sourceRows[0] : index
  return `${account}#${firstRow}`
}

// Build the deterministic commentary plan for ONE comparison set.
//
//   comparisons — the per-period rows the variance engine produced (the same
//                 array buildPeriodNarrative hands to every section builder)
//   options     — { thresholds } (carried for forward compatibility; NQ-3A
//                 derives materiality from the shared helpers, not raw thresholds)
//
// Returns { meta:{ counts }, items:[…], groups:[] }. `items` are ordered by
// materiality (largest dollar movement first) so the plan order is independent of
// the incoming array order. Every comparison row appears exactly once across the
// four dispositions (partition invariant). `groups` is intentionally empty in
// NQ-3A — theme grouping is a later phase.
export function buildCommentaryPlan(comparisons, options = {}) {
  void options
  const rows = Array.isArray(comparisons) ? comparisons.filter((c) => c && typeof c === 'object') : []
  const headline = headlineSet(rows)

  const items = rows
    .map((c, index) => {
      const disposition = dispositionOf(c, headline)
      const materiality = materialityOf(c, headline)
      const theme = themeOf(c.account, c.accountType)
      const evidenceAvailable = evidenceAvailableOf(c.account)
      const item = {
        id: idOf(c, index),
        disposition,
        materiality,
        theme,
        suppressReason: suppressReasonOf(c, disposition),
        evidenceAvailable,
        ownerQuestion: ownerQuestionOf({ theme, materiality, evidenceAvailable })
      }
      // Carry the source row alongside the item for the materiality sort only;
      // it is stripped before the plan is returned.
      return { item, c }
    })
    // Deterministic order: largest movement first, independent of input order.
    .sort((a, b) => byMateriality(a.c, b.c))
    .map((entry) => entry.item)

  const counts = { individual: 0, grouped: 0, suppressed: 0, rollup: 0 }
  for (const item of items) counts[item.disposition] += 1

  return { meta: { counts }, items, groups: [] }
}
