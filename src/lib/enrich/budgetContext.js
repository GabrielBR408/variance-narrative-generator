// --- Uploaded-budget supplemental context — Phase 2B -----------------------
// Surfaces GENUINELY NEW context from a SEPARATELY uploaded budget file into the
// narrative of an account the BASE report already flagged. Two kinds of context
// a base comparative statement does not carry:
//
//   • a per-account EXPLANATION of what the budget provides for (a Notes /
//     Assumptions / Description column), and
//   • monthly PHASING — how the annual budget is spread across the months.
//
// HARD BOUNDARY — this module never produces an owner-facing FIGURE. The base
// report's budget column is the single authoritative budget source for every
// number the narrative states (the owner's authoritative-source rule). So:
//   - explanation text is SANITIZED to strip every currency amount, date, and
//     reference token before it is ever rendered — an uploaded budget figure can
//     never appear as the budget;
//   - monthly phasing is rendered QUALITATIVELY ("weighted toward March", "spread
//     across the year") — never as a monthly dollar value.
// It also rejects any explanation carrying causal wording ("due to", "because"),
// so the budget's own prose can never assert a cause for the variance.
//
// Pure & deterministic: NO AI/LLM, NO network, NO variance math. Matching reuses
// the SAME scorer the rest of enrichment uses (scoreMatchDetailed in match.js) —
// it does not invent a second matching scheme. With no budget file, no match, or
// no genuinely-new context, it contributes nothing and the narrative is unchanged.

import { accountCode, normalizeName, tokensOf, scoreMatchDetailed, CONFIDENCE_FLOOR } from './match.js'
import { BUDGET_SUMMARY } from '../extract/fileType.js'
import { toNumber } from '../extract/normalize.js'

// Headers that name the account column. Deliberately tighter than the evidence
// index's column matcher so a free-text "Description"/"Notes" column is never
// mistaken for the account label.
const ACCOUNT_HEADER_RE = /account|acct|\bgl\b|\bg\/?l\b|ledger|chart|\bcode\b|item|\bline\b|category/i

// Headers that carry a per-account budget EXPLANATION (qualitative, owner-facing).
const EXPLANATION_HEADER_RE = /note|assumption|explanation|comment|description|detail|memo|narrative|basis|justification|purpose|remark/i

// Month names for detecting a monthly-phasing layout and for the qualitative
// descriptor. Abbreviations are matched on a word boundary so "may" inside a
// longer word never trips, and a full month header ("January") still matches.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
// A monthly budget must show most of the year before we describe its shape.
const MIN_MONTH_COLS = 6
// A month (or quarter) carrying at least this share of the year is "weighted".
const WEIGHTED_SHARE = 0.4

// Causal / forbidden wording: if the budget's own note asserts a cause, we never
// surface it (the variance's cause is determined by the comparative report, not
// the budget file). Mirrors the forbidden phrasings documented in templates.js.
const FORBIDDEN_CAUSAL_RE =
  /\b(due to|because|caused? by|driven by|result(?:ing|ed)?\s+(?:from|in)|owing to|attributable to|thanks to)\b/i

// Global strippers for any uploaded figure/date/reference embedded in free text.
const MONEY_STRIP_RE = /-?\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*\.\d{2}\b/g
const DATE_STRIP_RE = /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/g
const REFERENCE_STRIP_RE = /\b(?:inv|invoice|chk|check|ck|ref|po|ap|ar|doc|gs|cm|je)\b\s*\d+|#\s*\d+/gi
// Any remaining bare number or percentage (e.g. a stray "12%" or quantity).
const BARE_NUMBER_RE = /\b\d[\d,]*(?:\.\d+)?%?\b/g

// Leading filler words stripped so a note reads as a clean phrase after "where
// the budget provides for ". Looped, so "Budget of for roof work" → "roof work".
const LEADING_FILLER = new Set([
  'to', 'cover', 'covers', 'covering', 'provide', 'provides', 'providing',
  'include', 'includes', 'including', 'budget', 'budgeted', 'budgets',
  'assume', 'assumes', 'assuming', 'reflect', 'reflects', 'represent',
  'represents', 'for', 'the', 'of', 'a', 'an', 'this', 'and', 'is', 'are'
])
// Dangling prepositions to drop if left at the very end after stripping figures.
const TRAILING_PREP_RE = /\b(of|for|to|at|by|in|with|from|on|per)$/i

const MAX_EXPLANATION_LEN = 140
const MIN_EXPLANATION_WORDS = 2

// Is this supporting extraction a budget file we may mine for context? Either the
// content-detected budget summary, or a file the filename classifier named Budget.
function isBudgetFile(ex) {
  if (!ex || typeof ex !== 'object') return false
  if (ex.status && ex.status !== 'ok') return false
  const normalized = ex.normalized || {}
  if (normalized.fileType === BUDGET_SUMMARY) return true
  const t = (ex.classification && ex.classification.type) || ''
  return /budget|forecast/i.test(String(t))
}

function chooseAccountCol(columns) {
  for (let i = 0; i < columns.length; i++) {
    if (ACCOUNT_HEADER_RE.test(String(columns[i]))) return i
  }
  return 0
}

function explanationCols(columns, accountCol) {
  const out = []
  for (let i = 0; i < columns.length; i++) {
    if (i === accountCol) continue
    if (EXPLANATION_HEADER_RE.test(String(columns[i]))) out.push(i)
  }
  return out
}

function monthIndexOf(header) {
  const h = String(header).toLowerCase()
  for (let i = 0; i < 12; i++) {
    if (new RegExp(`(^|[^a-z])${MONTHS[i]}([^a-z]|$)`).test(h)) return i
  }
  return -1
}

function monthCols(columns) {
  const out = []
  for (let i = 0; i < columns.length; i++) {
    const m = monthIndexOf(columns[i])
    if (m >= 0) out.push({ col: i, month: m })
  }
  return out
}

// Turn a raw budget note into a clean, figure-free phrase, or '' when nothing
// safe/meaningful remains. Strips currency/date/reference/number tokens (so an
// uploaded figure can never render), rejects causal prose, drops leading filler
// and dangling prepositions, caps length, and lowercases the lead for mid-sentence
// reading (preserving an acronym).
export function sanitizeExplanation(raw) {
  let t = String(raw == null ? '' : raw)
  if (!t.trim()) return ''
  if (FORBIDDEN_CAUSAL_RE.test(t)) return ''

  t = t
    .replace(MONEY_STRIP_RE, ' ')
    .replace(REFERENCE_STRIP_RE, ' ')
    .replace(DATE_STRIP_RE, ' ')
    .replace(BARE_NUMBER_RE, ' ')
    .replace(/[•·•|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()

  // Strip leading filler words repeatedly (handles "Budget of …", "To cover …").
  let words = t.split(/\s+/).filter(Boolean)
  while (words.length && LEADING_FILLER.has(words[0].toLowerCase().replace(/[^a-z]/g, ''))) {
    words.shift()
  }
  t = words.join(' ').replace(/^[\s,;:.\-]+/, '').replace(/[\s,;:.\-]+$/, '').trim()
  t = t.replace(TRAILING_PREP_RE, '').replace(/[\s,;:.\-]+$/, '').trim()
  if (!t) return ''

  const meaningful = t.split(/\s+/).filter((w) => /[a-z]/i.test(w))
  if (meaningful.length < MIN_EXPLANATION_WORDS) return ''

  if (t.length > MAX_EXPLANATION_LEN) {
    t = t.slice(0, MAX_EXPLANATION_LEN).replace(/\s+\S*$/, '').replace(/[\s,;:.\-]+$/, '')
  }

  const first = t.split(/\s+/)[0] || ''
  if (!/^[A-Z]{2,}/.test(first)) t = t.charAt(0).toLowerCase() + t.slice(1)
  return t
}

// Describe how the year's budget is phased, qualitatively and figure-free, or
// null when there is no clear shape (or too few months to judge). Uses absolute
// magnitudes so a credit-signed line does not distort the share.
export function derivePhasing(row, monthsCols) {
  if (!Array.isArray(monthsCols) || monthsCols.length < MIN_MONTH_COLS) return null
  const vals = monthsCols.map(({ col, month }) => ({ month, v: Math.abs(toNumber(row[col]) ?? 0) }))
  const total = vals.reduce((acc, x) => acc + x.v, 0)
  if (total <= 0) return null
  const nonZero = vals.filter((x) => x.v > 0)
  if (nonZero.length <= 1) return null

  let peak = vals[0]
  for (const x of vals) if (x.v > peak.v) peak = x
  if (peak.v / total >= WEIGHTED_SHARE) {
    return `with budgeted spend weighted toward ${MONTH_NAMES[peak.month]}`
  }

  const quarters = [0, 0, 0, 0]
  for (const x of vals) quarters[Math.floor(x.month / 3)] += x.v
  let pq = 0
  for (let i = 1; i < 4; i++) if (quarters[i] > quarters[pq]) pq = i
  if (quarters[pq] / total >= WEIGHTED_SHARE) {
    const names = ['the first quarter', 'the second quarter', 'the third quarter', 'the fourth quarter']
    return `with budgeted spend weighted toward ${names[pq]}`
  }
  return 'with budgeted spend spread across the year'
}

// Build a flat, deterministic index of per-account budget CONTEXT entries from
// the uploaded budget file(s). Each entry is shaped like an evidence-index entry
// (code / normName / tokens) so scoreMatchDetailed can score it directly. Only
// accounts that yield a non-empty explanation or a phasing descriptor are kept,
// and a file that offers neither contributes nothing.
export function buildBudgetContextIndex(supporting = []) {
  const entries = []
  if (!Array.isArray(supporting)) return entries

  for (const ex of supporting) {
    if (!isBudgetFile(ex)) continue
    const normalized = ex.normalized || {}
    const columns = Array.isArray(normalized.columns) ? normalized.columns : []
    const rows = Array.isArray(normalized.rows) ? normalized.rows : []
    if (columns.length === 0 || rows.length === 0) continue

    const accCol = chooseAccountCol(columns)
    const expCols = explanationCols(columns, accCol)
    const mCols = monthCols(columns)
    // Nothing this file could add beyond the base report's own budget column.
    if (expCols.length === 0 && mCols.length < MIN_MONTH_COLS) continue

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      if (!Array.isArray(row)) continue
      const label = String(row[accCol] ?? '').trim()
      if (!label) continue
      const normName = normalizeName(label)
      if (!normName) continue

      let explanation = ''
      for (const ci of expCols) {
        const cleaned = sanitizeExplanation(row[ci])
        if (cleaned) { explanation = cleaned; break }
      }
      const phasing = mCols.length >= MIN_MONTH_COLS ? derivePhasing(row, mCols) : null
      if (!explanation && !phasing) continue

      entries.push({
        code: accountCode(label),
        normName,
        tokens: tokensOf(normName),
        label,
        explanation,
        phasing: phasing || ''
      })
    }
  }

  return entries
}

// Find the best budget-context entry for a flagged account using the SAME scorer
// the evidence index uses. Returns { explanation, phasing } when a confident
// match carries genuinely-new context, or null otherwise.
export function matchBudgetContext(account, index = [], options = {}) {
  const floor = Number.isFinite(options.floor) ? options.floor : CONFIDENCE_FLOOR
  if (!account || !Array.isArray(index) || index.length === 0) return null

  let best = null
  let bestScore = 0
  for (const entry of index) {
    const { score } = scoreMatchDetailed(account, entry)
    if (score < floor) continue
    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }
  if (!best) return null
  if (!best.explanation && !best.phasing) return null
  return { explanation: best.explanation || '', phasing: best.phasing || '' }
}
