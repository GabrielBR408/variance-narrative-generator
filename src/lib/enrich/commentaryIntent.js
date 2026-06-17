// --- Commentary Intent Engine — NQ-2A / NQ-2A.1 ----------------------------
// Builds the owner-facing EXPLANATION sentence (S2) for a GL-backed variance
// note, on top of the WHAT the base variance sentence (S1) already states. The
// desired structure is exactly two sentences:
//
//   S1  variance observation              (base narrative — unchanged)
//   S2  explanation + implication         (THIS module, detailed mode)
//
// NQ-2A.1 revision: the earlier NQ-2A appended a SEPARATE third "implication"
// sentence on top of an evidence sentence. Acceptance testing found that too
// subtle and too sparse — it still read "variance → evidence". So the evidence
// narration is replaced with a single EXPLANATION that folds the implication in.
// There is no third sentence: a note is never more than two sentences.
//
// Pure and deterministic: the same inputs always yield the same sentence. It
// performs NO extraction, NO matching, NO variance math, and NO AI/LLM — it only
// reads figures already computed upstream (the GL-detail summary, the Phase 19A
// classifier category, the Phase 19B contribution ranking, and the render-safe
// Phase 21.2 detail evidence) plus deterministic keyword signals from text that
// is NEVER itself rendered.
//
// Hard boundaries carried from the rest of enrichment:
//   • It NEVER asserts causation (no "due to / caused by / driven by / drove …"),
//     never states certainty, never gives financial advice, and never recommends
//     an action that needs human approval.
//   • It NEVER renders a date, reference, money figure, or file name. A render-
//     safe vendor / memo (already gated by Phase 21.2) may appear as the SUBJECT
//     of the explanation; raw keyword signals are read only to DECIDE wording.
//   • It returns null whenever no confident, supported explanation applies, so the
//     caller keeps the conservative evidence sentence (explanation only).
//
// Phrasing is intentionally hedged ("appears", "suggests", "may", "indicates")
// and never asserts that the GL caused the variance — the COMPARATIVE REPORT owns
// the variance; the GL is context only.

import { CONF_AE_MIN } from './classify.js'
import { polishVendor, polishMemo } from './templates.js'

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

// Build the EXPLANATION sentence (S2) for one GL-backed note, folding the
// implication into the explanation. Returns the sentence, or null to fall back
// to the conservative evidence sentence.
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
  accountType,
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

  // Figure-derived warnings (direction conflict, disproportion, offsets) are
  // grounded in the variance math itself, so they are allowed on any thick match.
  // Keyword / shape implications additionally require high confidence so an
  // uncertain account match never asserts a recurring / timing / one-time intent.
  const highConf = Number(confidence) >= CONF_AE_MIN

  let sentence = null

  // 1. Direction conflict — the GL net ran opposite to the reported movement.
  if (contributionType === 'direction-conflict' || type === 'DC') {
    sentence = 'Account activity ran opposite to the reported movement, which may indicate offsetting entries worth a closer look.'
  }
  // 2. Disproportionate — GL activity materially larger than the variance.
  else if (contributionType === 'disproportionate' || type === 'DP') {
    sentence = 'Observed activity exceeded the reported variance, suggesting net account movement was influenced by additional offsets.'
  }
  // 3. Offset-heavy / exceeds-variance — the GL total runs past the variance.
  else if (contributionType === 'offset-heavy' || type === 'OH' || exceedsVariance) {
    sentence = type === 'D'
      ? 'Activity occurred outside the planned budget and exceeded the reported variance, suggesting offsetting entries or timing effects influenced the result.'
      : 'Activity exceeded the reported variance, suggesting offsetting entries or timing effects influenced the reported result.'
  }
  // 4. Partial — the GL activity accounts for only part of the movement.
  else if (contributionType === 'partial' || type === 'PA') {
    sentence = 'Activity appears to explain part of the variance, with additional account movement recorded during the period.'
  }
  // ---- the remaining shapes are keyword / classifier driven (high confidence) --
  else if (highConf) {
    const lead = subject ? cap(subject) : 'Activity'

    // 5. Budget omission — activity against a zero/absent budget (category D).
    if (type === 'D') {
      sentence = recurring
        ? `${lead} appears to fall outside the planned budget and may represent recurring activity not yet budgeted.`
        : `${lead} occurred outside the planned budget and may warrant future budgeting.`
    }
    // 6. Credit / true-up / timing — a sign surprise (category E) or a timing
    //    keyword. A credit/refund reads as a timing adjustment even when a
    //    recurring word (e.g. "premium") is also present, so timing precedes
    //    recurring here.
    else if (type === 'E' || timingMemo) {
      sentence = subject
        ? `${cap(subject)} appears to reflect a timing or true-up adjustment that may reverse in a later period.`
        : 'This appears to reflect a timing or true-up adjustment that may reverse in a later period.'
    }
    // 7. Recurring — an evenly-spread population, or scheduled/repeating service.
    else if (type === 'C' || recurring) {
      sentence = subject
        ? `${cap(subject)} appears to explain the variance and may represent recurring activity.`
        : 'This appears to reflect recurring activity that may normalize over the period.'
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

  if (!sentence) return null
  // Reject-on-doubt: never emit causal or certainty language.
  if (CAUSAL_RE.test(sentence)) return null
  return sentence
}
