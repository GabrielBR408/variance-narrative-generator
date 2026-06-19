// --- Evidence contribution ranking — Phase 19B ----------------------------
// Decides whether GL evidence plausibly CONTRIBUTES to the variance, rather than
// just describing GL shape (Phase 19A). Pure and deterministic: the same inputs
// always yield the same output. It performs NO matching, NO summarizing, NO
// variance math, and NO AI/LLM — it only reads numbers already computed upstream
// (the GL-detail summary from match.js → summarizeDetail) and the variance's own
// fields (varianceAmount, accountType, category) carried on the note.
//
// Architecture (the approved decision): match.js stays matching-only and is NOT
// made contribution-aware. Ranking lives here, between summarize and classify:
//   extract → match → summarize → contribution → classify → template
//
// Output contract (exactly these fields):
//   { contributionType, ratio, directionAligned, amountReliable,
//     vendorRenderable, descriptionRenderable }

// Contribution ratio bands. The firm decision points from the approved spec are
// disproportionate > 3.0 and partial < 0.25; the aligned band is [0.50, 2.00].
// The 2.00–3.00 and 0.25–0.50 gaps resolve to the nearer non-aligned band so
// exactly one type always wins (anything above aligned is disproportionate,
// anything below is partial).
export const ALIGN_LOW = 0.5
export const ALIGN_HIGH = 2.0
export const SUPPRESS_RATIO = 10.0 // ratio above this ⇒ render no dollar at all

// Vendor / description renderability gates (string-quality only — there is no
// per-field confidence; match quality comes from the citation's match score,
// passed through as detail.confidence).
export const VENDOR_CONFIDENCE_MIN = 0.9
export const VENDOR_MAX_LEN = 30
export const VENDOR_MAX_COUNT = 3
export const DESCRIPTION_MAX_LEN = 50

// DATE_RE is the one pattern shared with the render-safety gate (identical).
import { DATE_RE } from './sanitationPatterns.js'

// A cell that is purely numeric/symbolic (no real name).
const NUMERIC_ONLY_RE = /^[\s\d.,$()%\-]+$/
// Reference / invoice / check / PO / doc / journal tokens, or any long digit run
// — the marks of an ID, never rendered as a vendor or description. NOTE: this is
// intentionally BROADER than the render-safety gate's REFERENCE_RE — it matches a
// bare keyword (no trailing digit required) and adds a long-digit-run clause,
// because here it filters ranking-time description tokens, not render output. Kept
// local on purpose; do not replace with the shared pattern.
const REFERENCE_LIKE_RE = /\b(inv|invoice|chk|check|ck|ref|po|ap|ar|doc|gs|je)\b|#\s*\d|\b\d{4,}\b/i
// A money or date token leaking into text → not a clean phrase. NOTE: also broader
// than the shared MONEY_RE (matches a bare "$" or "(<digit"); kept local for the
// same ranking-time filtering reason above.
const MONEY_RE = /\$|\(\s*\d|\d[\d,]*\.\d{2}\b/

function isReliableTotal(total) {
  return typeof total === 'number' && Number.isFinite(total) && total !== 0
}

// The sign GL net activity should carry to be *consistent with* the variance,
// given the account type and favorable/unfavorable direction. GL amounts are
// debit-positive (match.js nets debit − credit):
//   expense unfavorable (over budget)  → costs added   → +1
//   expense favorable   (under budget) → credits/true-ups → −1
//   revenue favorable   (revenue up)   → income posts as credit → −1
//   revenue unfavorable (revenue down) → reversals/debits → +1
// Unknown type or neutral direction → 0 (no conflict can be asserted).
function expectedSign(accountType, category) {
  if (accountType === 'expense') {
    if (category === 'unfavorable') return 1
    if (category === 'favorable') return -1
  }
  if (accountType === 'revenue') {
    if (category === 'favorable') return -1
    if (category === 'unfavorable') return 1
  }
  return 0
}

function isNumeric(s) {
  return NUMERIC_ONLY_RE.test(s)
}

function isReferenceLike(s) {
  return REFERENCE_LIKE_RE.test(s)
}

// A clean, readable phrase: has a letter, no money/date token, not reference-like.
function isCleanPhrase(s) {
  return /[A-Za-z]/.test(s) && !MONEY_RE.test(s) && !DATE_RE.test(s) && !isReferenceLike(s)
}

// Rank one GL-backed note's evidence by contribution relevance to its variance.
//   varianceAmount  — the note's dollar movement (sign carries direction)
//   accountType     — 'revenue' | 'expense' | 'unknown'
//   category        — 'favorable' | 'unfavorable' | 'neutral'
//   detail          — { total, maxTxn, count, vendor, description, confidence }
export function rankContribution({
  varianceAmount,
  comparisonType, // eslint-disable-line no-unused-vars -- part of the approved input contract
  accountType,
  category,
  detail = {}
} = {}) {
  const total = detail.total
  const amountReliable = isReliableTotal(total)
  const count = Number(detail.count) || 0
  const maxAbs =
    typeof detail.maxTxn === 'number' && Number.isFinite(detail.maxTxn) ? Math.abs(detail.maxTxn) : null
  const v = Math.abs(Number(varianceAmount))
  const haveVariance = Number.isFinite(v) && v > 0

  const ratio = amountReliable && haveVariance ? Math.abs(total) / v : null

  // Direction: only assessable with a reliable total and a grounded expected
  // sign; otherwise never assert a conflict.
  const exp = expectedSign(accountType, category)
  const directionAligned = !amountReliable || exp === 0 ? true : Math.sign(total) === exp

  // Offsets present when a single transaction is larger than the whole net total.
  const offset = amountReliable && maxAbs !== null && maxAbs > Math.abs(total)

  // Renderability gates (string-quality only).
  const confidence = Number(detail.confidence)
  const vendor = String(detail.vendor || '').trim()
  const description = String(detail.description || '').trim()

  let vendorRenderable =
    Number.isFinite(confidence) &&
    confidence >= VENDOR_CONFIDENCE_MIN &&
    vendor.length > 0 &&
    vendor.length <= VENDOR_MAX_LEN &&
    !isNumeric(vendor) &&
    !isReferenceLike(vendor) &&
    count <= VENDOR_MAX_COUNT

  let descriptionRenderable =
    description.length > 0 &&
    description.length <= DESCRIPTION_MAX_LEN &&
    !isReferenceLike(description) &&
    isCleanPhrase(description)

  // Never render both — vendor (the tighter-gated, more specific signal) wins.
  if (vendorRenderable) descriptionRenderable = false

  // Contribution type — first match wins (precedence per the plan):
  //   no-reliable-amount → direction-conflict → offset-heavy
  //   → disproportionate → partial → aligned
  let contributionType
  if (!amountReliable || ratio === null) {
    contributionType = count > 0 ? 'no-reliable-amount' : 'unquantified'
  } else if (!directionAligned) {
    contributionType = 'direction-conflict'
  } else if (offset) {
    contributionType = 'offset-heavy'
  } else if (ratio > ALIGN_HIGH) {
    contributionType = 'disproportionate'
  } else if (ratio < ALIGN_LOW) {
    contributionType = 'partial'
  } else {
    contributionType = 'aligned'
  }

  return { contributionType, ratio, directionAligned, amountReliable, vendorRenderable, descriptionRenderable }
}
