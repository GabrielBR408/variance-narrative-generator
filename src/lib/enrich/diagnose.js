// --- Variance diagnosis layer — NQ-5A (metadata only) ----------------------
// Deterministic DIAGNOSIS of a variance note: it names the NATURE of the
// movement (timing vs. permanent, real spend vs. accrual true-up vs. pass-through
// mapping) on top of the SHAPE that contribution.js / classify.js already
// describe. The owner-report process produces exactly this as its "Nature"
// column ("Accounting true-up, not real savings", "Timing", "Budget mapping
// (pass-through), not an overage"); this module consolidates the signals the
// pipeline already computes into one explicit, auditable object.
//
// Architecture (the approved NQ-5 decision): a new stage that READS already-
// computed signals and produces metadata. It performs NO extraction, NO matching,
// NO variance math, NO AI/LLM, and it owns NO regexes (the timing/recurring
// keyword detection stays in commentaryIntent.js — NQ-5A does not migrate it).
// It consumes only:
//   • the note's own figures (account, type, comparison basis, actual, variance)
//   • the account-name family from accountSemantics.js (structural fact)
//   • the Phase 19B contribution ranking (shape / direction / offset)
//   • the Phase 19A classifier category (one-time / recurring / credit / …)
//   • the deterministic GL-detail summary (count, total sign)
//   • the GL match confidence + thickness
//
// Hard boundaries (NQ-5A): METADATA ONLY. It is PURE (same inputs → same output),
// it MUTATES NOTHING, and — critically — it NEVER lowers any existing confidence.
// `diagnosis.confidence` is a SEPARATE advisory scale ('high'|'medium'|'low');
// it is not the GL match score and is never written back onto the note or its
// support. No template, planner, or export reads this object in NQ-5A, so output
// is byte-identical to before.

import { accountSemanticType } from './accountSemantics.js'
import { isImmaterialVariance, isMaterialVariance } from './commentaryIntent.js'
import { CONF_AE_MIN, CONF_G_MAX } from './classify.js'

// The closed taxonomy of variance natures (the diagnosis result). `null` (no
// confident diagnosis) is represented by a diagnosis object whose `nature` is
// null — diagnose() always returns an object so callers have a stable shape.
export const DIAGNOSIS_NATURES = Object.freeze([
  'TIMING_PHASING',
  'ACCRUAL_TRUEUP',
  'REAL_SPEND',
  'RECURRING_RATE',
  'UNBUDGETED',
  'MAPPING_PASSTHROUGH',
  'NON_CASH',
  'BALANCE_SHEET',
  'INDETERMINATE'
])

// Coarse provenance categories recorded in `evidenceSources` — WHERE the
// diagnosis drew from (vs. `basis`, which records the specific WHY facts).
export const EVIDENCE_SOURCES = Object.freeze([
  'ACCOUNT_NAME', // the account-name family (accountSemantics)
  'BUDGET_COMPARISON', // the budget basis / unbudgeted structure
  'VARIANCE_SIGN', // the reported actual / variance sign
  'GL_DETAIL', // the deterministic GL-detail summary
  'CONTRIBUTION', // the Phase 19B contribution ranking
  'CLASSIFIER' // the Phase 19A classifier category
])

// Per-nature owner action hint. Advisory metadata only.
const RECOMMENDATION = {
  ACCRUAL_TRUEUP: 'review',
  INDETERMINATE: 'review',
  TIMING_PHASING: 'monitor',
  MAPPING_PASSTHROUGH: 'monitor',
  RECURRING_RATE: 'monitor',
  UNBUDGETED: 'monitor',
  REAL_SPEND: 'none',
  NON_CASH: 'none',
  BALANCE_SHEET: 'none'
}

// Natures that rest on a structural FACT (the account name or the budget
// structure) rather than on transaction shape, so they carry `structural: true`
// and may be 'high' confidence even with thin / no GL.
const STRUCTURAL_NATURES = new Set([
  'NON_CASH',
  'BALANCE_SHEET',
  'MAPPING_PASSTHROUGH',
  'TIMING_PHASING',
  'UNBUDGETED'
])

// Account-name-only structural natures (decided purely from accountSemantics).
const NAME_STRUCTURAL = new Set(['NON_CASH', 'BALANCE_SHEET', 'MAPPING_PASSTHROUGH'])

function num(x) {
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

// Diagnose ONE variance note. `note` is required; the remaining inputs are the
// already-computed enrichment signals (null/false when unavailable, e.g. a non-GL
// or uncited note). Always returns the diagnosis object:
//   { nature, qualifiers, confidence, basis, recommendation, evidenceSources }
export function diagnose({
  note = {},
  contribution = null,
  classifyType = null,
  detail = null,
  confidence = null,
  thick = false,
  hasCitation = false
} = {}) {
  const account = note.account || ''
  const accountType = note.accountType
  const comparisonType = note.comparisonType
  const actual = num(note.actual)
  const comparison = num(note.comparison)
  const varianceAmount = num(note.varianceAmount)

  // --- derived signals (read-only; nothing mutated) ------------------------
  const sem = accountSemanticType(account) // 'NON_CASH' | 'RECOVERY' | 'TIMING' | null
  const total = detail ? num(detail.total) : null
  const reliableTotal = total !== null && total !== 0
  const count = detail ? Number(detail.count) || 0 : 0
  const contributionType = contribution && contribution.contributionType
  const budgetBasis = comparisonType === 'budget'
  const unbudgeted = budgetBasis && (comparison === 0 || comparison === null)
  const hasActivity = !!thick && count > 0
  const zeroActual = actual === 0 || actual === null
  const credit = (reliableTotal && total < 0) || (actual !== null && actual < 0)
  const directionConflict = contributionType === 'direction-conflict'
  const offset = contributionType === 'offset-heavy' || classifyType === 'OH'
  const direction =
    budgetBasis && varianceAmount !== null && varianceAmount !== 0
      ? varianceAmount > 0
        ? 'above'
        : 'below'
      : null

  // Confidence inputs from the GL match (advisory only).
  const conf = num(confidence)
  const strongGL = conf !== null && conf >= CONF_AE_MIN && !!thick && reliableTotal
  const moderateGL = conf !== null && conf >= CONF_G_MAX && !!thick

  const basis = []
  const sources = new Set()
  const mark = (reason, ...srcs) => {
    basis.push(reason)
    for (const s of srcs) sources.add(s)
  }

  // --- precedence (the approved NQ-5 decision rules) -----------------------
  // Structural account-name families win first — they are factual regardless of
  // materiality. RECOVERY → MAPPING_PASSTHROUGH deliberately beats UNBUDGETED so a
  // recovery line is never called an overage.
  let nature = null
  if (sem === 'NON_CASH') {
    nature = 'NON_CASH'
    mark('accountSemantics:NON_CASH', 'ACCOUNT_NAME')
  } else if (sem === 'TIMING') {
    nature = 'BALANCE_SHEET'
    mark('accountSemantics:TIMING', 'ACCOUNT_NAME')
  } else if (sem === 'RECOVERY') {
    nature = 'MAPPING_PASSTHROUGH'
    mark('accountSemantics:RECOVERY', 'ACCOUNT_NAME')
  } else if (isImmaterialVariance(note)) {
    // Operationally trivial line with no structural account family → no diagnosis.
    mark('immaterial')
  } else if (zeroActual && budgetBasis && comparison !== null && comparison > 0 && !hasActivity) {
    // Budgeted but nothing posted (and no GL activity) → a timing / phasing gap.
    nature = 'TIMING_PHASING'
    mark('zero-actual-vs-budget', 'BUDGET_COMPARISON')
    if (detail) sources.add('GL_DETAIL')
  } else if (credit || directionConflict) {
    // A net credit / opposite-direction movement reads as an accrual / true-up.
    nature = 'ACCRUAL_TRUEUP'
    if (directionConflict) mark('contribution:direction-conflict', 'CONTRIBUTION', 'GL_DETAIL')
    if (credit) mark('credit-sign', 'VARIANCE_SIGN', ...(reliableTotal ? ['GL_DETAIL'] : []))
  } else if (unbudgeted && hasActivity) {
    // Real activity against a zero / absent budget.
    nature = 'UNBUDGETED'
    mark('unbudgeted-with-activity', 'BUDGET_COMPARISON', 'GL_DETAIL')
  } else if (classifyType === 'C') {
    // Recurring population (classifier C) — a run-rate difference.
    nature = 'RECURRING_RATE'
    mark('classifier:C', 'CLASSIFIER', 'GL_DETAIL')
  } else if (hasActivity && reliableTotal && (contributionType === 'aligned' || ['A', 'B', 'I', 'F'].includes(classifyType))) {
    // Aligned, quantified real transactions → genuine operating spend.
    nature = 'REAL_SPEND'
    mark('aligned-real-activity', 'GL_DETAIL')
    if (contributionType) sources.add('CONTRIBUTION')
    if (classifyType) sources.add('CLASSIFIER')
  } else if (isMaterialVariance(note) && (!hasCitation || !thick || contributionType === 'unquantified')) {
    // Material but unsupported / unquantified / conflicting → flag for review.
    nature = 'INDETERMINATE'
    mark('material-unexplained', 'VARIANCE_SIGN')
    if (offset) {
      basis.push('contribution:offset-heavy')
      sources.add('CONTRIBUTION')
    }
  } else {
    mark('no-confident-diagnosis')
  }

  const qualifiers = {
    recurring: classifyType === 'C',
    oneTime: classifyType === 'A',
    credit: !!credit,
    offset: !!offset,
    structural: nature !== null && STRUCTURAL_NATURES.has(nature),
    direction
  }

  return {
    nature,
    qualifiers,
    confidence: deriveConfidence(nature, { strongGL, moderateGL }),
    basis,
    recommendation: nature === null ? 'none' : RECOMMENDATION[nature],
    evidenceSources: [...sources]
  }
}

// The advisory diagnosis confidence ('high'|'medium'|'low'). It is NOT the GL
// match score and is never written back onto the note (NQ-5A: diagnosis cannot
// lower any existing confidence). Structural account-name natures are high (a name
// is a fact); INDETERMINATE is low by definition; structural budget natures default
// to medium unless strongly corroborated; GL-shape natures scale with match quality.
function deriveConfidence(nature, { strongGL, moderateGL }) {
  if (nature === null) return 'low'
  if (NAME_STRUCTURAL.has(nature)) return 'high'
  if (nature === 'INDETERMINATE') return 'low'
  if (strongGL) return 'high'
  if (nature === 'TIMING_PHASING') return 'high' // a clear budgeted-but-unposted fact
  if (moderateGL) return 'medium'
  return 'medium'
}
