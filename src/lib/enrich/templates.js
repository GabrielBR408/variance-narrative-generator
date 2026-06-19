// --- Supporting-evidence wording — Phase 16 / 17 / 17.1 -------------------
// Owner-facing supporting-evidence language. Pure string builders: they read
// only the account label (from the BASE report, never a file name), the period,
// the supporting file's classification, and the deterministic GL-detail summary.
//
// Accounting rule (Phase 17.1): the COMPARATIVE REPORT determines the variance;
// GL / budget / supporting files provide CONTEXT ONLY. So no rendered phrase
// asserts or implies the evidence caused, drove, explains, or supports the
// variance. GL evidence renders as a STANDALONE evidence sentence; non-GL
// evidence remains a short, conservative clause merged into the variance line.
//
// Forbidden phrasings (never emitted): "primarily due to", "due to", "caused by",
// "driven by", "supporting the variance", "explains", "because of",
// "resulting from".
//
// Hard rules carried from Phase 16/17:
//   • Never render a file name, "Supporting file", or any debug/source language.
//   • Never invent or quote a figure from a supporting file (GL totals are real
//     sums of matched rows, rounded and flagged "approximately").
//   • Never say "current-period" for a year-to-date period.

import { normalizeName } from './match.js'
import { SUPPRESS_RATIO } from './contribution.js'

// A readable account label: strip a leading numeric code so
// "5100 Utility Expense Recovery" reads as "Utility Expense Recovery". Falls
// back to the original label if stripping would leave nothing.
export function displayAccount(account = '') {
  const stripped = String(account)
    .replace(/^\s*[0-9][0-9.\-]*\s*[·:.\-]?\s*/, '')
    .trim()
  return stripped || String(account).trim()
}

// The period phrase appended to an evidence sentence. YTD is still called out as
// "year-to-date"; the current/unknown period now OMITS the mechanical
// "during the current period" suffix entirely, so owner-facing commentary reads
// as plain business prose instead of period-stamped extraction notes. Returns a
// leading-space clause (or '') ready to drop in just before the closing period.
function periodClause(period) {
  if (period === 'ytd') return ' year-to-date'
  return ''
}

// A small, deterministic lexicon mapping well-known account-name tokens to a
// friendly descriptor. Derived ONLY from the base account name (allowed); no
// hit drops the descriptor entirely rather than guessing. First match wins.
const DESCRIPTOR_LEXICON = [
  [/elect/i, 'electric'],
  [/water|sewer/i, 'water'],
  [/\bgas\b|natural\s*gas/i, 'gas'],
  [/insurance/i, 'insurance'],
  [/repair|mainten/i, 'repairs and maintenance'],
  [/utilit/i, 'utility'],
  [/payroll|salar|wage/i, 'payroll'],
  [/landscap/i, 'landscaping'],
  [/\btax(es)?\b/i, 'tax'],
  [/management|mgmt/i, 'management'],
  [/clean|janitor/i, 'cleaning'],
  [/legal/i, 'legal'],
  [/advertis|marketing/i, 'marketing'],
  // NQ-4A.1 — descriptor expansion. Friendly render words drawn ONLY from the
  // base account name (never a figure, never a file name). Ordered most-specific
  // first so e.g. "Lease Term Concessions" reads as a concession and
  // "Parking Garage Rental" reads as parking, not the generic "rental".
  [/concession/i, 'concession'],
  [/reimburs/i, 'reimbursement'],
  [/recover/i, 'recovery'],
  [/\bcommon\s*area\b|\bcam\b/i, 'common area'],
  [/parking/i, 'parking'],
  [/storage/i, 'storage'],
  [/\b(lease|leasing|occupancy|tenant)\b/i, 'leasing'],
  [/\brent\b|rental/i, 'rental']
]

export function descriptorFor(account = '') {
  const a = String(account)
  for (const [re, word] of DESCRIPTOR_LEXICON) if (re.test(a)) return word
  return ''
}

// Round a GL total to a sensible "approximately" magnitude so it reads as an
// aggregate, never a fabricated exact figure: nearest 100 at/above $1,000, else
// nearest 10. Formatted with thousands separators and no decimals. Shared with
// the Excel export so the narrative and the workbook present totals identically.
export function approxMoney(total) {
  const abs = Math.abs(total)
  const step = abs >= 1000 ? 100 : 10
  const rounded = Math.round(abs / step) * step
  return `$${rounded.toLocaleString('en-US')}`
}

// --- Phase 19A: classified GL commentary ----------------------------------
// Render the owner-facing GL sentence for a classifier category (see
// classify.js). Pure string builder: it reads only the category and the same
// deterministic GL-detail summary used elsewhere, plus the base account label
// for an optional friendly descriptor. It never renders a vendor string, a date,
// a reference/invoice ID, or a file name, and carries no causal language.
// Amounts are always passed through approxMoney() so a raw row figure is never
// re-quoted as an exact value.
export function commentarySentence({ type, account, detail, period, contribution, varianceAmount, accountType } = {}) {
  const d = detail || {}
  const count = Number(d.count) || 0
  const total = d.total
  const reliableTotal = typeof total === 'number' && Number.isFinite(total) && total !== 0
  const maxTxn = typeof d.maxTxn === 'number' && Number.isFinite(d.maxTxn) ? Math.abs(d.maxTxn) : null
  const yp = periodClause(period)

  // Render guard (render-only; contribution categories are unchanged). Within the
  // aligned band the GL total can be up to 2× the variance, which reads as if the
  // larger GL figure IS the variance. So whenever the dollar we would render
  // exceeds the reported variance, we suppress the figure and say so instead.
  // Compared on raw magnitudes (not the rounded display) so an equal total never
  // trips on rounding.
  const v = Math.abs(Number(varianceAmount))
  const exceedsVariance = reliableTotal && Number.isFinite(v) && Math.abs(total) > v + 0.005

  // Phase 19B: contribution categories. These never render a single transaction
  // larger than the net total, and suppress the dollar entirely when the GL
  // activity is more than ~10× the variance (ratio > SUPPRESS_RATIO).
  const ratio = contribution && typeof contribution.ratio === 'number' ? contribution.ratio : null
  const suppress = ratio === null || ratio > SUPPRESS_RATIO

  switch (type) {
    case 'DC': // Direction conflict — GL net sign opposes the variance direction.
      // Caution preserved (the GL ran the other way) without the mechanical
      // "runs counter to the variance direction and warrants review" boilerplate.
      if (suppress) {
        return `Related activity reflects a large net credit running opposite to the reported movement, which may be worth a closer look.`
      }
      return total < 0
        ? `Related activity reflects a net credit of approximately ${approxMoney(Math.abs(total))}${yp}, running opposite to the reported movement and worth a closer look.`
        : `Related activity of approximately ${approxMoney(total)}${yp} runs opposite to the reported movement and may be worth a closer look.`

    case 'OH': // Offset-heavy — a single line exceeds the net total; never show it.
      return suppress
        ? `Related activity was substantially larger and includes offsetting entries${yp}.`
        : `Related activity of approximately ${approxMoney(total)} includes offsetting entries${yp}.`

    case 'DP': // Disproportionate — GL activity far larger than the variance.
      return suppress
        ? `Related activity was materially larger than the reported variance, indicating the variance reflects only part of the account movement${yp}.`
        : `Related activity totaled approximately ${approxMoney(total)}${yp}, indicating the variance reflects only part of the account movement.`

    case 'PA': // Partial — GL activity far smaller than the variance.
      return `Related activity totaled approximately ${approxMoney(total)}${yp}, accounting for a portion of the total movement.`
  }

  // Aligned render guard (#1): the dollar we would render is larger than the
  // reported variance — drop the figure and state the relationship instead. The
  // Unbudgeted (D) lead is preserved because it is a structural fact, not a size.
  if (exceedsVariance && type !== 'G') {
    return type === 'D'
      ? `This activity occurred without a budget allocation, and related activity exceeded the reported variance${yp}, suggesting offsetting entries or account-level timing also affected the result.`
      : `Related activity exceeded the reported variance${yp}, suggesting offsetting entries or account-level timing also affected the result.`
  }

  // Phase 19B: on an aligned, quantified shape, optionally embed a clean vendor
  // (replacing the descriptor) or append a clean short description. Mutually
  // exclusive (the contribution stage already cleared description when vendor
  // is renderable). Both are context only — never causal.
  const ALIGNED_QUANTIFIED = new Set(['A', 'B', 'C', 'I', 'F'])
  if (reliableTotal && contribution && ALIGNED_QUANTIFIED.has(type)) {
    if (contribution.vendorRenderable && d.vendor) {
      return `The movement reflects approximately ${approxMoney(total)} of related ${d.vendor} activity${yp}.`
    }
    if (contribution.descriptionRenderable && d.description) {
      const base = shapeSentence({ type, account, count, total, reliableTotal, maxTxn, yp, accountType })
      return `${base.replace(/\.\s*$/, '')} (${d.description}).`
    }
  }

  return shapeSentence({ type, account, count, total, reliableTotal, maxTxn, yp, accountType })
}

// --- Phase 21.3: detailed commentary (opt-in) -----------------------------
// Build an OPT-IN detailed GL sentence from the render-safe detail evidence
// selected in Phase 21.2 (`detailEvidence`). Conservative mode NEVER calls this
// — it is reached only when the caller passes mode: 'detailed'. It renders at
// most ONE sanitized vendor/memo phrase per note, never lists multiple vendors,
// never asserts causation, and renders nothing unsafe (the 21.2 gate already
// stripped dates / references / money / page-bleed / codes / account numbers).
//
// Returns null whenever it should fall back to the conservative sentence:
//   • no evidence, or evidenceConfidence is 'low' / 'none' (do not over-render)
//   • neither a render-safe vendor nor memo survived selection
//   • a direction-conflict (the conservative "runs counter" warning must win)
// The final causal-language guard is a belt-and-suspenders reject-on-doubt net;
// the wording below is causation-free by construction.
const CAUSAL_RE = /\b(caused by|due to|because of|driven by|drove|resulting from|result of|explains?|attributable to)\b/i

// --- Phase 21.4: deterministic vendor / memo polish ------------------------
// Render-time normalization (the reconstructed metadata is left untouched). The
// reconstruction layer (21.1) title-cases generically, which mangles acronyms
// and hyphenated names (e.g. "Sfpuc-water Department", "Pyro-comm Systems INC.").
// These helpers fix the casing/wording for the rendered phrase only, with a
// small known-vendor canon table and conservative general rules — unknown
// vendors are NOT aggressively rewritten.

// Acronyms kept all-caps; corporate suffixes given a canonical form.
const VENDOR_ACRONYMS = new Set(['SFPUC', 'PAC', 'PG&E', 'AT&T', 'FA', 'HVAC', 'LLC', 'LLP', 'LP'])
const VENDOR_SUFFIX_CASE = { inc: 'Inc.', corp: 'Corp.', co: 'Co.', ltd: 'Ltd.', company: 'Company' }

// Normalized lookup key: lowercase, collapse any non-alphanumeric (except &) to a
// single space. So "SFPUC-WATER DEPT", "Sfpuc-water Department" → same key.
function normKey(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim()
}

// Known vendors → canonical rendered form (keyed on normKey).
const VENDOR_CANON = {
  'pg&e': 'PG&E',
  'pg e': 'PG&E',
  'sfpuc water department': 'SFPUC Water Department',
  'sfpuc water dept': 'SFPUC Water Department',
  'sfpuc water': 'SFPUC Water Department',
  'pyro comm systems inc': 'Pyro-Comm Systems Inc.',
  'pyro comm systems': 'Pyro-Comm Systems Inc.',
  'bay city mechanical service llc': 'Bay City Mechanical Service LLC',
  'trinity building services': 'Trinity Building Services',
  'recology golden gate': 'Recology Golden Gate',
  'foliate llc': 'Foliate LLC',
  'san francisco tax collector': 'San Francisco Tax Collector',
  'franchise tax board': 'Franchise Tax Board',
  'pac integrations': 'PAC Integrations',
  'armada security': 'Armada Security',
  'heise s plumbing': "Heise's Plumbing",
  'heises plumbing': "Heise's Plumbing"
}

// Case one hyphen/space part of a vendor token.
function caseVendorPart(p) {
  if (!p) return p
  const trailingDot = /\.$/.test(p)
  const bare = p.replace(/\.+$/, '')
  const up = bare.toUpperCase()
  if (VENDOR_ACRONYMS.has(up)) return up + (trailingDot ? '.' : '')
  const lc = bare.toLowerCase()
  if (VENDOR_SUFFIX_CASE[lc]) return VENDOR_SUFFIX_CASE[lc]
  if (bare.includes('&')) return up // e.g. AT&T, PG&E
  return bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase() + (trailingDot ? '.' : '')
}

// NQ-4A.1 — generalize possessive recovery. Extraction commonly drops the
// apostrophe, leaving a stray "s" token ("Heise S Plumbing"). The known-vendor
// canon already fixes the named cases; this rejoins the general case so an UNSEEN
// possessive vendor reads correctly. Conservative by construction: it only fires
// when a lone "s" follows a real word (≥2 letters), so initials and ordinary
// names are untouched, and it adds no digits/dates/references (reject-on-doubt
// is unaffected — selection already gated the string upstream).
function mergePossessives(name) {
  return String(name).replace(/\b([A-Za-z]{2,})\s+s\b/gi, "$1's")
}

export function polishVendor(vendor) {
  const v = String(vendor || '').trim()
  if (!v) return v
  const canon = VENDOR_CANON[normKey(v)]
  if (canon) return canon
  // General, conservative rule: rejoin a dropped possessive, then title-case each
  // space- and hyphen-separated part, preserving known acronyms and canonical
  // suffixes. Keeps hyphens for unknowns.
  return mergePossessives(v)
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => tok.split('-').map(caseVendorPart).join('-'))
    .join(' ')
}

// Common memo fragments → cleaner owner-facing wording (keyed on normKey).
const MEMO_CANON = {
  'elec & gas': 'electric and gas',
  'elec gas': 'electric and gas',
  'rent commercial': 'commercial rent',
  'rent parking': 'parking rent',
  'annual fa testing': 'annual fire alarm testing',
  water: 'water service',
  'hvac repair': 'HVAC repair',
  'janitorial supply': 'janitorial supplies'
}

export function polishMemo(memo) {
  const m = String(memo || '').trim()
  if (!m) return m
  const canon = MEMO_CANON[normKey(m)]
  if (canon) return canon
  // NQ-4A.1: expand a standalone ampersand to "and" so an unseen memo reads as
  // prose ("Repairs & Grounds" → "repairs and grounds"). Only a spaced "&" is
  // touched, so embedded acronyms like AT&T / PG&E are preserved.
  const expanded = m.replace(/\s+&\s+/g, ' and ')
  // General: read naturally mid-sentence (lowercase the first letter) unless the
  // memo leads with an acronym we must preserve (e.g. "HVAC").
  const firstWord = (expanded.split(/\s+/)[0] || '').toUpperCase()
  if (VENDOR_ACRONYMS.has(firstWord)) return expanded
  return expanded.charAt(0).toLowerCase() + expanded.slice(1)
}

// Build the opt-in detailed GL sentence from the render-safe detail evidence
// (Phase 21.2 `detailEvidence`), with Phase 21.4 vendor/memo polish applied at
// render time. Renders at most ONE vendor/memo phrase per note, never lists
// multiple vendors, and never asserts causation. Returns null to fall back to
// the conservative sentence when the evidence is not safe enough to render.
export function detailedCommentarySentence({ evidence, contribution, period } = {}) {
  if (!evidence) return null
  const { evidenceConfidence, vendorRenderable, memoRenderable } = evidence
  // Do not render detail when confidence is low/none (do not over-render).
  if (evidenceConfidence !== 'high' && evidenceConfidence !== 'medium') return null

  const vendor = vendorRenderable ? polishVendor(evidence.vendor) : ''
  const memo = memoRenderable ? polishMemo(evidence.memo) : ''
  if (!vendor && !memo) return null

  const yp = periodClause(period)
  const contributionType = contribution && contribution.contributionType

  // A direction conflict carries an important "ran the other way / worth a closer
  // look" signal — prefer the conservative sentence over a softer detail phrase.
  if (contributionType === 'direction-conflict') return null

  // Exactly one vendor/memo phrase; memo + vendor preferred, then vendor, then
  // memo. `subject` reads as a clause head for every variant.
  const subject = vendor && memo ? `${memo} from ${vendor}` : vendor ? `activity from ${vendor}` : memo

  let sentence
  if (contributionType === 'offset-heavy') {
    sentence = `The variance reflects ${subject}, partially offset by related entries${yp}.`
  } else if (contributionType === 'disproportionate') {
    // Reworded to avoid repeating "related activity" within one sentence.
    sentence = `The variance reflects ${subject}, though related activity exceeded the reported variance${yp}.`
  } else {
    sentence = `The variance reflects ${subject}${yp}.`
  }

  // Reject-on-doubt: never emit causal language even if wording changes later.
  if (CAUSAL_RE.test(sentence)) return null
  return sentence
}

// The Phase 19A shape sentence (A–I). Factored out so Phase 19B can embed a
// vendor/description around it without duplicating the per-shape wording.
function shapeSentence({ type, account, count, total, reliableTotal, maxTxn, yp, accountType }) {
  switch (type) {
    case 'A': // One-time
      return reliableTotal
        ? `The movement reflects a single transaction of approximately ${approxMoney(total)}${yp}.`
        : `The movement reflects a single related transaction${yp}.`

    case 'B': // One-time-dominated
      // NQ-4A.1: surface the top contributor explicitly. Uses the already-computed
      // maxTxn / total / count — no new calculation, no causal claim.
      return (
        `The movement reflects approximately ${approxMoney(total)} across ${count} transactions, ` +
        `with the largest single item about ${approxMoney(maxTxn)} of the total${yp}.`
      )

    case 'C': // Recurring
      return `The movement reflects approximately ${approxMoney(total)} across ${count} recurring transactions${yp}.`

    case 'D': // Unbudgeted
      return reliableTotal
        ? `This activity occurred without a budget allocation and totaled approximately ${approxMoney(total)}${yp}.`
        : 'This activity occurred without a budget allocation and should be reviewed for future forecasting.'

    case 'E': // Credit / true-up
      // #3 Revenue credit softening: on a revenue (or untyped income-like) line a
      // net credit is normal income, so avoid "single credit"/"net credits" and
      // phrase it as related credit activity. Expense true-ups keep "credit".
      if (accountType !== 'expense') {
        return `The movement reflects related credit activity of approximately ${approxMoney(Math.abs(total))}${yp}.`
      }
      return count === 1
        ? `The movement reflects a single credit of approximately ${approxMoney(Math.abs(total))}${yp}.`
        : `The movement reflects net credits of approximately ${approxMoney(Math.abs(total))} across ${count} transactions${yp}.`

    case 'I': // Concentrated activity
      return `The movement was concentrated in approximately ${approxMoney(total)} across two related transactions${yp}.`

    case 'G': // Low-confidence / thin
      return 'Account-level activity was available for review.'

    case 'F': // Quantified fallback
    default: {
      if (!reliableTotal) {
        if (count > 0) {
          const noun = count === 1 ? 'transaction' : 'transactions'
          return `Activity was spread across ${count} related ${noun}${yp}.`
        }
        return 'Account-level activity was available for review.'
      }
      const descriptor = descriptorFor(account)
      const kind = descriptor ? `${descriptor} ` : ''
      if (count === 1) {
        return `The movement reflects approximately ${approxMoney(total)} of related ${kind}activity${yp}.`
      }
      return `The movement reflects approximately ${approxMoney(total)} across ${count} related ${kind}transactions${yp}.`
    }
  }
}

// Build a NON-GL supporting-evidence clause (no leading comma, no trailing
// period — the caller merges it into the variance sentence). GL evidence is NOT
// handled here; it renders as its own sentence elsewhere. All wording is
// conservative context, with no causal language. Returns '' when no clause
// applies, leaving the variance sentence untouched.
export function explanationClause({ classificationType = '' } = {}) {
  const type = String(classificationType)

  // GL is rendered as a standalone sentence elsewhere — never a clause here.
  if (/general\s*ledger|\bgl\b/i.test(type)) return ''

  // Budget / forecast — context only, no causation.
  if (/budget|forecast/i.test(type)) {
    return 'compared against scheduled budget assumptions for the period'
  }
  // Prior-period detail — conservative, no causation.
  if (/prior|previous/i.test(type)) {
    return 'consistent with the prior-period detail provided'
  }
  // A matching variance schedule — conservative.
  if (/variance/i.test(type)) {
    return 'consistent with the supporting variance detail provided'
  }
  // Any other supporting document — conservative, owner-facing.
  return 'matched against detail in the source records'
}

// Re-export so callers can build an index/normalize without reaching into match.
export { normalizeName }
