// --- Supporting-evidence matching — Phase 15 -------------------------------
// Deterministic, content-only matching of a flagged base-report account against
// rows extracted from supporting files. NO AI/LLM, NO embeddings, NO network —
// just normalized string comparison with an explicit, auditable confidence
// score and floor. Pure functions: the same inputs always produce the same
// matches in the same order.
//
// Matching tiers (highest first):
//   1.0  exact account CODE match (leading numeric token, e.g. "5100")
//   0.9  exact normalized NAME match
//   0.7  conservative substring containment (guarded by length + token count)
//   <0.6 partial token overlap — below the floor, so never attached
//
// Anything scoring below CONFIDENCE_FLOOR is discarded, so a weak/partial
// resemblance never produces a citation.

import { toNumber } from '../extract/normalize.js'

export const CONFIDENCE_FLOOR = 0.6
export const MAX_CITATIONS_PER_NOTE = 3

// Columns in a supporting file that are likely to carry the account label.
const ACCOUNT_COL_RE = /account|acct|description|\bgl\b|\bname\b|item|line|category/i

// Columns that carry transactional detail. Their presence WITH a real value is
// what makes GL evidence "thick" — solid enough to phrase a cause — versus a
// bare name match ("thin"), which only confirms the line appears in the file.
const AMOUNT_COL_RE = /amount|debit|credit|balance|charge|total|\bvalue\b|\bnet\b|cost|\$/i
const DETAIL_COL_RE = /description|memo|detail|narrative|note|particular|reference|\bref\b|vendor|payee|invoice|\bdoc\b|check/i

// Phase 19B: column-typed detail. To let the contribution stage render a clean
// vendor OR a clean description (never a reference/invoice ID), split the detail
// columns by kind. Vendor/payee/name carry a counterparty; description/memo a
// short narrative; reference/invoice/check/doc carry IDs that are NEVER rendered.
// (DETAIL_COL_RE above stays the thickness signal — it spans all three kinds.)
const VENDOR_COL_RE = /vendor|payee|\bname\b/i
const DESC_COL_RE = /description|memo|detail|narrative|note|particular/i

// A leading numeric token used as an account code: "5100", "5100-10", "51.00".
const CODE_RE = /^\s*([0-9][0-9.\-]*[0-9]|[0-9])/

// Cells that are purely numeric/symbolic are values, not account labels.
const NUMERIC_ONLY_RE = /^[\s0-9.,$()%\-]+$/

export function accountCode(label = '') {
  const m = String(label).match(CODE_RE)
  return m ? m[1].replace(/[.\-]+$/, '') : ''
}

// Lowercase, strip a leading code token, drop punctuation, collapse whitespace.
// "5100 · Utility Expense Recovery" → "utility expense recovery".
export function normalizeName(label = '') {
  return String(label)
    .toLowerCase()
    .replace(/^\s*[0-9][0-9.\-]*\s*[·:.\-]?\s*/, '') // leading code + separator
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokensOf(normName = '') {
  return normName.split(' ').filter(Boolean)
}

// Build a flat, deterministic index of candidate account entries from the
// supporting extractions. Only files that read cleanly contribute. Each entry
// records its file, classification, derived code/normalized-name/tokens, and the
// source row index for traceability.
export function buildEvidenceIndex(supporting = []) {
  const entries = []
  if (!Array.isArray(supporting)) return entries

  for (const ex of supporting) {
    if (!ex || typeof ex !== 'object') continue
    if (ex.status && ex.status !== 'ok') continue
    const normalized = ex.normalized || {}
    const rows = Array.isArray(normalized.rows) ? normalized.rows : []
    if (rows.length === 0) continue

    const columns = Array.isArray(normalized.columns) ? normalized.columns : []
    let col = columns.findIndex((c) => ACCOUNT_COL_RE.test(String(c)))
    if (col < 0) col = 0

    // Pre-resolve which columns (other than the account column) carry an amount
    // or a description/reference, so per-row thickness is a cheap lookup.
    const amountCols = []
    const detailCols = []
    const vendorCols = []
    const descCols = []
    for (let i = 0; i < columns.length; i++) {
      if (i === col) continue
      const h = String(columns[i])
      if (AMOUNT_COL_RE.test(h)) amountCols.push(i)
      if (DETAIL_COL_RE.test(h)) detailCols.push(i)
      if (VENDOR_COL_RE.test(h)) vendorCols.push(i)
      if (DESC_COL_RE.test(h)) descCols.push(i)
    }

    const fileName = ex.fileName || ''
    const classificationType = (ex.classification && ex.classification.type) || 'Supporting Document'

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      if (!Array.isArray(row)) continue
      const label = String(row[col] ?? '').trim()
      if (!label || NUMERIC_ONLY_RE.test(label)) continue
      const normName = normalizeName(label)
      if (!normName) continue
      entries.push({
        fileName,
        classificationType,
        label,
        code: accountCode(label),
        normName,
        tokens: tokensOf(normName),
        sourceRow: r,
        // Thick = this matched row carries a usable amount or description/reference.
        // When no headers identify amount columns (e.g. a positional PDF table),
        // fall back to "any non-account cell parses as a number".
        hasDetail: rowHasDetail(row, col, amountCols, detailCols),
        // Phase 17: the row's reliably-parsed amount (or null when ambiguous) and
        // its description/vendor text, for deterministic GL-detail summaries.
        amount: reliableAmount(row, col, amountCols),
        detailText: firstDetailText(row, detailCols),
        // Phase 19B: column-typed text, kept separate so a reference/invoice ID
        // can never surface where a vendor or description is expected.
        vendorText: firstDetailText(row, vendorCols),
        descText: firstDetailText(row, descCols)
      })
    }
  }
  return entries
}

// Does a matched row carry transactional detail beyond its account label?
// True when an amount column holds a number (or, with no typed amount columns,
// any non-account cell parses as a number), or a description/reference column
// holds non-numeric text. Pure read of cells already normalized upstream.
function rowHasDetail(row, accountCol, amountCols, detailCols) {
  const hasAmount =
    amountCols.length > 0
      ? amountCols.some((i) => toNumber(row[i]) !== null)
      : row.some((cell, i) => i !== accountCol && toNumber(cell) !== null)
  const hasDescription = detailCols.some((i) => {
    const t = String(row[i] ?? '').trim()
    return t !== '' && toNumber(t) === null
  })
  return hasAmount || hasDescription
}

// The row's amount, but ONLY when it can be read unambiguously — so a total we
// later sum is trustworthy. Reliable when there is exactly one typed amount
// column, or (for a positional table with no typed headers) exactly one numeric
// cell outside the account column. A Debit+Credit pair, a Balance column, or any
// multi-amount layout is ambiguous → null, and totals are omitted downstream.
function reliableAmount(row, accountCol, amountCols) {
  if (amountCols.length === 1) return toNumber(row[amountCols[0]])
  if (amountCols.length === 0) {
    let found = null
    let count = 0
    row.forEach((cell, i) => {
      if (i === accountCol) return
      const n = toNumber(cell)
      if (n !== null) {
        count++
        found = n
      }
    })
    return count === 1 ? found : null
  }
  return null
}

// The first non-empty, non-numeric description/reference/vendor cell, trimmed.
// '' when none — never a number, never an account label.
function firstDetailText(row, detailCols) {
  for (const i of detailCols) {
    const t = String(row[i] ?? '').trim()
    if (t !== '' && toNumber(t) === null) return t
  }
  return ''
}

// Aggregate the matched rows of ONE file into a deterministic GL-detail summary:
//   { count, total, maxTxn, topVendor, topVendorCount }
// total is the summed amount ONLY when every matched row contributed a reliable
// amount (otherwise null, so we never present a partial/ambiguous total).
// topVendor is the most frequent description/vendor across matched rows (ties
// broken by first appearance), or null when none carries text.
function summarizeDetail(rows) {
  const count = rows.length
  let total = 0
  let amountsSeen = 0
  let maxTxn = null

  for (const row of rows) {
    if (typeof row.amount === 'number' && Number.isFinite(row.amount)) {
      total += row.amount
      amountsSeen++
      const mag = Math.abs(row.amount)
      if (maxTxn === null || mag > maxTxn) maxTxn = mag
    }
  }

  // Legacy (Phase 17): topVendor/topVendorCount from the collapsed detailText —
  // retained for the Excel export and existing metadata tests.
  const top = mostFrequent(rows, 'detailText')
  // Phase 19B: column-typed vendor/description candidates. These are raw strings;
  // the contribution stage decides whether either is clean enough to render.
  const vendor = mostFrequent(rows, 'vendorText').value
  const description = mostFrequent(rows, 'descText').value

  return {
    count,
    total: amountsSeen === count && count > 0 ? total : null,
    maxTxn,
    topVendor: top.value,
    topVendorCount: top.count,
    vendor,
    description
  }
}

// The most frequent non-empty value of `field` across rows (ties broken by first
// appearance). Returns { value: string|null, count: number }.
function mostFrequent(rows, field) {
  const order = []
  const counts = new Map()
  for (const row of rows) {
    const v = (row[field] || '').trim()
    if (!v) continue
    if (!counts.has(v)) order.push(v)
    counts.set(v, (counts.get(v) || 0) + 1)
  }
  let value = null
  let count = 0
  for (const v of order) {
    const c = counts.get(v)
    if (c > count) {
      value = v
      count = c
    }
  }
  return { value, count }
}

// Score one base account against one index entry. Returns 0..1.
export function scoreMatch(baseAccount, entry) {
  const baseCode = accountCode(baseAccount)
  const baseNorm = normalizeName(baseAccount)
  if (!baseNorm) return 0
  const baseTokens = tokensOf(baseNorm)

  // 1) Exact account code.
  if (baseCode && entry.code && baseCode === entry.code) return 1.0
  // 2) Exact normalized name.
  if (baseNorm === entry.normName) return 0.9
  // 3) Conservative substring containment, guarded so short/single-word labels
  //    (e.g. "tax") cannot match a longer unrelated account.
  if (
    baseNorm.length >= 5 &&
    entry.normName.length >= 5 &&
    baseTokens.length >= 2 &&
    entry.tokens.length >= 2 &&
    (entry.normName.includes(baseNorm) || baseNorm.includes(entry.normName))
  ) {
    return 0.7
  }
  // 4) Partial token overlap — deliberately scaled below the floor so a partial
  //    resemblance is scored but never attached on its own.
  const baseSet = new Set(baseTokens)
  let shared = 0
  for (const t of new Set(entry.tokens)) if (baseSet.has(t)) shared++
  const denom = Math.max(baseTokens.length, entry.tokens.length, 1)
  return 0.6 * (shared / denom)
}

// Match one flagged account to supporting evidence. Returns a deterministic,
// deduped, capped list of citations:
//   [{ fileName, classificationType, confidence, sourceRows, thick, detail }]
// One citation per file (best score, all matching rows collected), ordered by
// file name then first source row. `thick` is true when ANY matched row in the
// file carried usable amount/description detail. `detail` is the Phase 17
// GL-detail summary over that file's matched rows.
export function matchAccount(account, index = [], options = {}) {
  const floor = Number.isFinite(options.floor) ? options.floor : CONFIDENCE_FLOOR
  const cap = Number.isFinite(options.cap) ? options.cap : MAX_CITATIONS_PER_NOTE
  if (!account || !Array.isArray(index) || index.length === 0) return []

  const byFile = new Map()
  for (const entry of index) {
    const score = scoreMatch(account, entry)
    if (score < floor) continue
    let existing = byFile.get(entry.fileName)
    if (!existing) {
      existing = {
        fileName: entry.fileName,
        classificationType: entry.classificationType,
        confidence: score,
        thick: false,
        // Dedupe matched rows by source-row index, so a repeated identical row
        // can never inflate the count or total.
        rows: new Map()
      }
      byFile.set(entry.fileName, existing)
    }
    existing.confidence = Math.max(existing.confidence, score)
    existing.thick = existing.thick || !!entry.hasDetail
    if (!existing.rows.has(entry.sourceRow)) {
      existing.rows.set(entry.sourceRow, {
        amount: entry.amount,
        detailText: entry.detailText,
        vendorText: entry.vendorText,
        descText: entry.descText
      })
    }
  }

  return [...byFile.values()]
    .map((c) => {
      const sourceRows = [...c.rows.keys()].sort((a, b) => a - b)
      const orderedRows = sourceRows.map((r) => c.rows.get(r))
      return {
        fileName: c.fileName,
        classificationType: c.classificationType,
        confidence: c.confidence,
        sourceRows,
        thick: c.thick,
        detail: summarizeDetail(orderedRows)
      }
    })
    .sort((a, b) => {
      const byName = a.fileName.localeCompare(b.fileName)
      if (byName !== 0) return byName
      return (a.sourceRows[0] ?? 0) - (b.sourceRows[0] ?? 0)
    })
    .slice(0, cap)
}
