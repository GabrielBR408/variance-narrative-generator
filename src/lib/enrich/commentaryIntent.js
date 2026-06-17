// --- Commentary Intent Engine — NQ-2A --------------------------------------
// Adds the WHY and SO-WHAT to a GL-backed variance note, on top of the WHAT the
// base variance sentence already states. Pure and deterministic: the same inputs
// always yield the same sentence. It performs NO extraction, NO matching, NO
// variance math, and NO AI/LLM — it only reads figures already computed upstream
// (the GL-detail summary, the Phase 19A classifier category, and the Phase 19B
// contribution ranking) plus deterministic keyword signals from text that is
// NEVER itself rendered.
//
// Architecture (the approved pipeline position, unchanged):
//   extract → match → summarize → reconstruct → select → classify → contribution
//     → template (WHAT + cause) → INTENT (this module, the SO-WHAT)
//
// The intent sentence is the OPTIONAL third sentence of the desired structure:
//   S1  variance observation        (base narrative — unchanged)
//   S2  cause hypothesis / evidence  (enrich templates — unchanged)
//   S3  implication, if confident    (THIS module — additive, optional)
//
// Hard boundaries carried from the rest of enrichment:
//   • It NEVER asserts causation (no "due to / caused by / driven by / drove …"),
//     never states certainty, never gives financial advice, and never recommends
//     an action that needs human approval.
//   • It NEVER renders a vendor, date, reference, money figure, or file name — it
//     reads keyword signals from text only to DECIDE which implication applies.
//   • It returns null whenever no confident, non-redundant implication applies,
//     so a note keeps exactly its S1 + S2 (the common case).
//
// The phrasing is intentionally hedged ("appears", "may") and limited to the
// approved implication vocabulary: may normalize, monitor, consider a budget
// adjustment, appears one-time, appears recurring.

import { CONF_AE_MIN } from './classify.js'

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
  /\b(caused by|due to|because of|driven by|drove|resulting from|result of|explains?|attributable to|will|definitely|certainly|must)\b/i

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

// Decide the optional implication sentence (S3) for one GL-backed note.
//
//   type            — the Phase 19A / 19B classifier category (A,B,C,D,E,I,F,
//                     DC,OH,DP,PA, G)
//   contributionType— the Phase 19B contribution category, or null
//   confidence      — the GL citation's match confidence (0..1)
//   thick           — whether the citation carried usable amount/description
//   exceedsVariance — the render guard already tripped (GL > variance)
//   account, detail, reconstructed, detailEvidence — signal inputs (not rendered)
//
// Returns the implication sentence, or null when none applies. High confidence
// is required (thick AND confidence ≥ CONF_AE_MIN) so a less-certain match never
// asserts an implication.
export function commentaryImplication({
  type,
  contributionType,
  confidence = 0,
  thick = false,
  exceedsVariance = false,
  account = '',
  detail = {},
  reconstructed = null,
  detailEvidence = null
} = {}) {
  // Gate 1: only confident, thick evidence may carry an implication.
  if (!thick || !(Number(confidence) >= CONF_AE_MIN)) return null
  // Gate 2: low-confidence / thin shapes never get a SO-WHAT.
  if (type === 'G') return null

  const text = detectionText({ account, detail, reconstructed, detailEvidence })
  const recurring = RECURRING_RE.test(text)
  const timingMemo = TIMING_RE.test(text)

  // S2 already carries a timing / offset intent for these shapes, so an added
  // timing implication would be redundant. A recurring or budget-omission
  // implication is orthogonal and still allowed for them.
  const timingInS2 =
    contributionType === 'direction-conflict' ||
    contributionType === 'offset-heavy' ||
    contributionType === 'disproportionate' ||
    exceedsVariance

  let sentence = null

  // 1. Budget omission — activity against a zero/absent budget (category D).
  if (type === 'D') {
    sentence = recurring
      ? 'The activity appears recurring and may not have been reflected in the operating budget.'
      : 'This activity appears to fall outside the operating budget and may warrant a budget adjustment.'
  }
  // 2. Credit / true-up / timing — a sign surprise (category E) or an explicit
  //    timing keyword. Checked before "recurring" so a credit/refund is read as a
  //    timing adjustment even when a recurring word (e.g. "premium") is present.
  //    Skipped when S2 already states the timing/offset intent (no duplication).
  else if ((type === 'E' || timingMemo) && !timingInS2) {
    sentence = 'This appears to reflect a timing or true-up adjustment worth monitoring.'
  }
  // 3. Recurring — the classifier saw an evenly-spread population, or the detail
  //    reads as scheduled/repeating service.
  else if (type === 'C' || recurring) {
    sentence = 'This appears to reflect recurring service activity that may normalize over the period.'
  }
  // 4. One-time — a single or one-transaction-dominated movement, with no
  //    recurring or timing signal, where S2 is not an offset/disproportion shape.
  else if ((type === 'A' || type === 'B') && !timingInS2) {
    sentence = 'This appears to be a one-time item that may normalize in future periods.'
  }

  if (!sentence) return null
  // Reject-on-doubt: never emit causal or certainty language.
  if (CAUSAL_RE.test(sentence)) return null
  return sentence
}
