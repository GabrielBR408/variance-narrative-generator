// --- Commentary Intent Engine — NQ-2A / NQ-2A.1 / NQ-2B --------------------
// Builds the owner-facing EXPLANATION sentence (S2) for a variance note, on top
// of the WHAT the base variance sentence (S1) already states. The desired
// structure is exactly two sentences:
//
//   S1  variance observation              (base narrative — unchanged)
//   S2  explanation + implication         (THIS module, detailed mode)
//
// NQ-2A.1 replaced evidence narration with a single explanation. NQ-2B applies
// the most common reviewer feedback on top, with small, safe rules:
//   1. Reduce generic boilerplate ("Activity exceeded …", "may normalize …",
//      "may warrant future budgeting").
//   2. Prefer a render-safe vendor / service description over generic offset /
//      timing language whenever GL detail provides one.
//   3. Zero-actual budgeted lines get a clear factual statement.
//   4. Material variances with NO supporting detail are flagged for review,
//      never speculated about.
//   5. Negative actuals / opposite-direction activity call out credit / reversal
//      behavior explicitly.
//   6. Operationally immaterial (very small dollar) variances get no detailed
//      commentary at all.
//
// Pure and deterministic: the same inputs always yield the same sentence. It
// performs NO extraction, NO matching, NO variance math, and NO AI/LLM — it only
// reads figures already computed upstream (the GL-detail summary, the Phase 19A
// classifier category, the Phase 19B contribution ranking, and the render-safe
// Phase 21.2 detail evidence) plus deterministic keyword signals from text that
// is NEVER itself rendered.
//
// Hard boundaries carried from the rest of enrichment:
//   • It NEVER asserts causation, certainty, or financial advice.
//   • It NEVER renders a date, reference, money figure, or file name. A render-
//     safe vendor / memo (already gated by Phase 21.2) may appear as the SUBJECT
//     of the explanation; raw keyword signals are read only to DECIDE wording.
//   • It returns null whenever no confident, supported explanation applies.

import { CONF_AE_MIN } from './classify.js'
import { polishVendor, polishMemo } from './templates.js'
import { accountSemanticCommentary } from './accountSemantics.js'

// Materiality bands (NQ-2B). Deterministic absolute dollars so the same line
// always reads the same way regardless of report size.
//   MATERIAL_DOLLAR    — a variance at/above this is "material"; a material line
//                        with no supporting detail is flagged for review (rule 4).
//   IMMATERIAL_DOLLAR  — below this a variance is operationally trivial and gets
//                        no detailed commentary (rule 6) …
//   IMMATERIAL_MAX_PCT — … UNLESS its percentage swing is at/above this (a very
//                        large percentage can still be worth a word).
export const MATERIAL_DOLLAR = 10000
export const IMMATERIAL_DOLLAR = 100
export const IMMATERIAL_MAX_PCT = 200

// Recurring-pattern signals. A hit means the activity reads as scheduled /
// repeating service rather than a surprise. Deterministic, word-boundary only,
// and deliberately conservative — bare "service" is excluded (too generic).
const RECURRING_RE =
  /\b(annual|annually|monthly|quarterly|recurring|contract|inspection|monitoring|monitor|maintenance|subscription|retainer|premium|testing|test)\b/i

// Timing / true-up signals in the detail text (credit, reversal, accrual, …).
// These mark a movement that is more about WHEN activity landed than NEW spend.
const TIMING_RE = /\b(reversal|reverse|reclass|true-?up|accrual|refund|prepaid|deferral|deferred|offset)\b/i

// A belt-and-suspenders reject net: never emit causal or certainty language even
// if the wording table is edited later. Mirrors the guard in templates.js.
const CAUSAL_RE =
  /\b(caused by|due to|because of|driven by|drove|resulting from|result of|attributable to|will|definitely|certainly|must)\b/i

// Capitalize the first letter so a subject can lead a sentence.
function cap(s) {
  const str = String(s)
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str
}

// Reject-on-doubt: a final guard so no rule sentence can carry causal/certainty
// language. Returns the sentence, or null when it trips the guard.
function safe(sentence) {
  if (!sentence) return null
  return CAUSAL_RE.test(sentence) ? null : sentence
}

// Build a lowercase detection blob from fields that are NEVER rendered. Reading
// raw reconstructed/vendor/description text here is safe precisely because the
// output is a fixed, sanitized sentence — none of this text reaches the owner.
function detectionText({ account, detail, reconstructed, detailEvidence }) {
  const parts = [
    account,
    detail && detail.description,
    detail && detail.vendor,
    detail && detail.topVendor,
    reconstructed && reconstructed.cleanMemo,
    reconstructed && reconstructed.vendor,
    detailEvidence && detailEvidence.memo,
    detailEvidence && detailEvidence.vendor
  ]
  return parts.filter(Boolean).join(' ').toLowerCase()
}

// The render-safe SUBJECT of the explanation, drawn from the Phase 21.2 detail
// evidence (already gated for safety). Mirrors detailedCommentarySentence's
// subject selection: memo (optionally "… from <vendor>"), else "activity from
// <vendor>". A trailing corporate "." (Inc./LLC.) is stripped so the vendor sits
// cleanly mid-sentence and never reads as a sentence boundary. Returns
// { subject, isMemo } or null when nothing render-safe survives.
function renderSafeSubject(detailEvidence) {
  if (!detailEvidence) return null
  const { evidenceConfidence, vendorRenderable, memoRenderable } = detailEvidence
  if (evidenceConfidence !== 'high' && evidenceConfidence !== 'medium') return null
  const vendor = vendorRenderable ? polishVendor(detailEvidence.vendor).replace(/\.+$/, '') : ''
  const memo = memoRenderable ? polishMemo(detailEvidence.memo) : ''
  if (!vendor && !memo) return null
  if (memo && vendor) return { subject: `${memo} from ${vendor}`, isMemo: true }
  if (memo) return { subject: memo, isMemo: true }
  return { subject: `activity from ${vendor}`, isMemo: false }
}

// Period suffix for the plan-direction explanation. Other phrasings are period-
// agnostic (an implication about the future does not carry a YTD stamp).
function planPeriod(period) {
  return period === 'ytd' ? ' year-to-date' : ' for the period'
}

// --- NQ-2B note-level helpers (no GL detail required) ----------------------

function num(x) {
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

// Rule 3 — a zero-actual budgeted line (actual = 0, budget > 0 on a budget
// basis). Clear, factual, no speculation about WHY. Expense lines read as "no
// service or expense"; everything else as "no activity posted".
export function zeroActualCommentary(note = {}) {
  if (note.comparisonType !== 'budget') return null
  const actual = num(note.actual)
  const budget = num(note.comparison)
  if (actual !== 0 || budget === null || budget <= 0) return null
  return note.accountType === 'expense'
    ? 'No service or expense was recorded in the period.'
    : 'No activity posted against the budgeted amount.'
}

// Rule 5a — a negative reported actual reads as a net credit / reversal. Stated
// explicitly and factually (the sign is real), never as a cause.
export function negativeActualCommentary(note = {}) {
  const actual = num(note.actual)
  if (actual === null || actual >= 0) return null
  return 'This line reflects a net credit or reversal posted in the period.'
}

// Rule 4 — material variance threshold (used to decide when an UNexplained line
// is flagged for review).
export function isMaterialVariance(note = {}) {
  const dollar = Math.abs(num(note.varianceAmount) ?? 0)
  return dollar >= MATERIAL_DOLLAR
}

// Rule 6 — operationally immaterial: a very small dollar swing that is not also
// a very large percentage swing. Such lines get no detailed commentary.
export function isImmaterialVariance(note = {}) {
  const dollar = Math.abs(num(note.varianceAmount) ?? 0)
  if (dollar >= IMMATERIAL_DOLLAR) return false
  const pct = Math.abs(num(note.variancePercent) ?? 0)
  return pct < IMMATERIAL_MAX_PCT
}

// Finalize the detailed-mode S2 for ONE note, applying the NQ-2B note-level
// rules around the GL-derived explanation (`glSentence`, which may be null).
// Returns the sentence to append, or null to leave S1 standing alone.
//
// Precedence (most specific / most certain first):
//   3. zero-actual budgeted line   → factual "no activity" statement
//   5a. negative actual            → explicit credit / reversal callout
//   NQ-2C account semantics        → cautious type wording for non-cash /
//                                    recovery / timing accounts, in place of the
//                                    generic operating-expense fallback
//   GL explanation                 → the vendor-led / figure-derived sentence,
//                                    suppressed (rule 6) on immaterial lines
//   4. material + no GL detail      → flag for review, never speculate
//   else                           → null (no commentary; reduces boilerplate)
export function finalizeNoteCommentary({ note = {}, glSentence = null, hasCitation = false } = {}) {
  const zero = zeroActualCommentary(note)
  if (zero) return safe(zero)

  const credit = negativeActualCommentary(note)
  if (credit) return safe(credit)

  // NQ-2C: for special account families (non-cash, recovery, timing / balance
  // sheet) a generic operating-expense explanation is misleading, so cautious
  // type wording replaces it. Still suppressed on operationally immaterial lines.
  const semantic = accountSemanticCommentary(note)
  if (semantic) {
    if (isImmaterialVariance(note)) return null
    return safe(semantic)
  }

  if (glSentence) {
    if (isImmaterialVariance(note)) return null
    return safe(glSentence)
  }

  if (!hasCitation && isMaterialVariance(note)) {
    return safe('This is a material variance and should be reviewed with supporting detail.')
  }
  return null
}

// Build the EXPLANATION sentence (S2) for one GL-backed note, folding the
// implication into the explanation. Returns the sentence, or null to fall back
// to the conservative evidence sentence.
//
// NQ-2B rule 2: when a render-safe vendor / memo SUBJECT exists, it LEADS the
// explanation even for the figure-derived shapes (offset / disproportion /
// partial / direction-conflict), so a real vendor or service description
// replaces the generic "Activity exceeded the reported variance" boilerplate.
//
//   type            — the Phase 19A / 19B classifier category
//   contribution    — the Phase 19B contribution result (or null)
//   confidence      — the GL citation's match confidence (0..1)
//   thick           — whether the citation carried usable amount/description
//   exceedsVariance — the render guard tripped (GL total > reported variance)
//   account, detail, reconstructed, detailEvidence — signal/subject inputs
//   accountType, comparisonType, category, varianceAmount — note figures
//   period          — 'current' | 'ytd' | …
export function explanationCommentary({
  type,
  contribution,
  confidence = 0,
  thick = false,
  exceedsVariance = false,
  account = '',
  detail = {},
  accountType, // eslint-disable-line no-unused-vars -- reserved by the approved input contract
  comparisonType,
  category, // eslint-disable-line no-unused-vars -- reserved by the approved input contract
  varianceAmount,
  period,
  reconstructed = null,
  detailEvidence = null
} = {}) {
  // Thin (name-only) or low-confidence (G) evidence cannot support a claim — keep
  // the conservative evidence sentence.
  if (!thick || type === 'G') return null

  const contributionType = contribution && contribution.contributionType
  const subjectInfo = renderSafeSubject(detailEvidence)
  const subject = subjectInfo ? subjectInfo.subject : null

  const text = detectionText({ account, detail, reconstructed, detailEvidence })
  const recurring = RECURRING_RE.test(text)
  const timingMemo = TIMING_RE.test(text)

  // Keyword / shape implications require high confidence so an uncertain account
  // match never asserts a recurring / timing / one-time intent. Figure-derived
  // warnings are grounded in the variance math and allowed on any thick match.
  const highConf = Number(confidence) >= CONF_AE_MIN

  let sentence = null

  // 1. Direction conflict — the GL net ran opposite to the reported movement.
  //    Rule 5: call out credit / reversal behavior explicitly.
  if (contributionType === 'direction-conflict' || type === 'DC') {
    sentence = subject
      ? `${cap(subject)} ran opposite to the reported movement, consistent with credits or reversals in the period.`
      : 'Account activity ran opposite to the reported movement, consistent with credits or reversals in the period.'
  }
  // 2. Disproportionate — GL activity materially larger than the variance.
  //    NQ-2C rule 3: without a render-safe subject, use a tighter fallback that
  //    drops the speculative "influenced by additional offsets" tail.
  else if (contributionType === 'disproportionate' || type === 'DP') {
    sentence = subject
      ? `${cap(subject)} appears in the account detail, though related activity exceeded the reported variance.`
      : 'Account activity was larger than the reported variance.'
  }
  // 3. Offset-heavy / exceeds-variance — the GL total runs past the variance.
  //    NQ-2C rule 3: the no-subject fallback is shortened to a single clause.
  else if (contributionType === 'offset-heavy' || type === 'OH' || exceedsVariance) {
    if (subject) {
      sentence = `${cap(subject)} appears in the account detail, partially offset by related entries in the period.`
    } else {
      sentence = type === 'D'
        ? 'Activity outside the planned budget exceeded the reported variance for the period.'
        : 'Account activity exceeded the reported variance for the period.'
    }
  }
  // 4. Partial — the GL activity accounts for only part of the movement.
  //    NQ-2C rule 3: the no-subject fallback is shortened to a single clause.
  else if (contributionType === 'partial' || type === 'PA') {
    sentence = subject
      ? `${cap(subject)} appears to explain part of the variance, with additional account activity in the period.`
      : 'Account activity accounts for part of the reported variance.'
  }
  // ---- the remaining shapes are keyword / classifier driven (high confidence) --
  else if (highConf) {
    const lead = subject ? cap(subject) : 'Activity'

    // 5. Budget omission — activity against a zero/absent budget (category D).
    //    Rule 1: drop the soft "may warrant future budgeting" recommendation.
    if (type === 'D') {
      sentence = recurring
        ? `${lead} appears to fall outside the planned budget and may represent recurring activity not yet budgeted.`
        : `${lead} was recorded outside the planned budget for the period.`
    }
    // 6. Credit / true-up / timing — a sign surprise (category E) or a timing
    //    keyword. Checked before recurring so a credit/refund reads as timing.
    else if (type === 'E' || timingMemo) {
      sentence = subject
        ? `${cap(subject)} appears to reflect a timing or true-up adjustment that may reverse in a later period.`
        : 'This appears to reflect a timing or true-up adjustment that may reverse in a later period.'
    }
    // 7. Recurring — an evenly-spread population, or scheduled/repeating service.
    //    Rule 1: drop the overused "may normalize over the period" tail.
    else if (type === 'C' || recurring) {
      sentence = subject
        ? `${cap(subject)} appears to explain the variance and may represent recurring activity.`
        : 'This appears to reflect recurring activity in the account.'
    }
    // 8. Aligned activity (one-time or quantified). With a subject and a known
    //    budget direction, state where it landed relative to plan; otherwise read
    //    it as a one-time item. Without a subject, defer to the conservative
    //    evidence sentence rather than assert an unsupported implication.
    else if (type === 'A' || type === 'B' || type === 'I' || type === 'F') {
      const v = Number(varianceAmount)
      const knownDirection = comparisonType === 'budget' && Number.isFinite(v) && v !== 0
      if (subject && knownDirection) {
        const dir = v > 0 ? 'above' : 'below'
        // A bare memo reads better as "<memo> activity"; a "… from <vendor>"
        // phrase or a vendor-only subject already names the activity.
        const head = subjectInfo.isMemo && !subject.includes(' from ') ? `${subject} activity` : subject
        sentence = `${cap(head)} was ${dir} plan${planPeriod(period)}.`
      } else if (subject) {
        sentence = `${cap(subject)} appears to explain the variance and may not recur in future periods.`
      }
    }
  }

  return safe(sentence)
}
