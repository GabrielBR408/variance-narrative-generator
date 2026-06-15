// --- Deterministic commentary classifier — Phase 19A ----------------------
// Maps already-computed GL evidence + the variance's own fields to ONE owner
// commentary category. Pure and deterministic: the same inputs always yield the
// same category. It performs NO extraction, NO matching, NO variance math, and
// NO AI/LLM — it only reads the GL-detail summary produced upstream
// (`match.js → summarizeDetail`) and the comparison figure already on the note.
//
// Categories (rendered by `templates.js → commentarySentence`):
//   A  One-time              single transaction
//   B  One-time-dominated    one transaction dominates the total
//   C  Recurring             several evenly-spread transactions
//   D  Unbudgeted            activity against a zero/absent budget
//   E  Credit / true-up      a net credit (negative total)
//   F  Quantified fallback   thick + reliable, no distinguishing shape
//   G  Low-confidence        thin match, or below the A–E/I confidence band
//   I  Concentrated          two related transactions
//   (H "no evidence" is handled by the caller — a note with no GL citation is
//    returned unchanged, so the classifier is never invoked for it.)
//
// Allowed inputs only (Phase 19A contract): variance direction, actual, budget,
// variance %, account type, transaction count, total, max transaction, support
// confidence, amount sign, supporting type. It deliberately does NOT read dates,
// reference/invoice IDs, vendor strings, or file names — vendor frequency is NOT
// used (recurrence is detected purely from the count and the max/total ratio).

// Confidence bands (revised PM model). `confidence` is the deterministic match
// score from match.js (1.0 code, 0.9 name, 0.7 substring; floor 0.6).
export const CONF_G_MAX = 0.70 // below this → low-confidence (G)
export const CONF_AE_MIN = 0.85 // at/above this → specific categories (A–E, I)

// Shape thresholds on ratio = max single transaction / |total|.
export const DOMINANCE_RATIO = 0.80 // one transaction dominates → B
export const CONCENTRATED_MIN_RATIO = 0.60 // two-transaction concentration → I
export const RECURRING_MAX_RATIO = 0.60 // no single transaction dominates → C
export const RECURRING_MIN_COUNT = 3 // recurring needs at least this many …
export const RECURRING_MAX_COUNT = 12 // … and no more (large populations are not "recurring")

function isReliableTotal(total) {
  return typeof total === 'number' && Number.isFinite(total) && total !== 0
}

// Classify ONE GL-backed note into a commentary category. Returns `{ type }`.
//   detail          — { count, total, maxTxn, ... } from summarizeDetail
//   comparison      — the budget (or prior) figure already on the note
//   comparisonType  — 'budget' | 'prior' | null (D only applies to a budget basis)
//   confidence      — the GL citation's match confidence
//   thick           — whether the GL citation carried usable amount/description
export function classifyGLCommentary({
  detail = {},
  comparison,
  comparisonType,
  confidence = 0,
  thick = false
} = {}) {
  // 0. Thin (name-only) evidence can never support a specific claim.
  if (!thick) return { type: 'G' }

  const count = Number(detail.count) || 0
  const total = detail.total
  const reliableTotal = isReliableTotal(total)
  const maxTxn =
    typeof detail.maxTxn === 'number' && Number.isFinite(detail.maxTxn) ? Math.abs(detail.maxTxn) : null
  const ratio = reliableTotal && maxTxn !== null ? maxTxn / Math.abs(total) : null

  // 1–2. Confidence gating. Moderate confidence is capped at the quantified
  // fallback (F) so a less-certain account match never asserts a shape.
  if (confidence < CONF_G_MAX) return { type: 'G' }
  if (confidence < CONF_AE_MIN) {
    return reliableTotal ? { type: 'F' } : { type: 'G' }
  }

  // 3. High confidence (≥ 0.85): specific categories are eligible. Evaluate in a
  // fixed precedence so exactly one category wins.

  // a. Unbudgeted — a structural fact about the variance (budget basis only).
  const unbudgeted =
    comparisonType !== 'prior' && (comparison === 0 || comparison === null || comparison === undefined)
  if (unbudgeted) return { type: 'D' }

  // b. Credit / true-up — a sign surprise; flag before counting.
  if (reliableTotal && total < 0) return { type: 'E' }

  // c. One-time.
  if (count === 1) return { type: 'A' }

  // d. One-time-dominated.
  if (count > 1 && ratio !== null && ratio >= DOMINANCE_RATIO) return { type: 'B' }

  // e. Recurring — several, evenly spread, within a bounded population.
  if (
    count >= RECURRING_MIN_COUNT &&
    count <= RECURRING_MAX_COUNT &&
    ratio !== null &&
    ratio <= RECURRING_MAX_RATIO
  ) {
    return { type: 'C' }
  }

  // f. Concentrated — exactly two related transactions (B already took the
  //    dominated case, so this is the 0.60 ≤ ratio < 0.80 band).
  if (count === 2 && ratio !== null && ratio >= CONCENTRATED_MIN_RATIO) return { type: 'I' }

  // g. Quantified fallback.
  return { type: 'F' }
}
