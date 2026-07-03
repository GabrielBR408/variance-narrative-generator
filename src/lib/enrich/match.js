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
import { SECTIONED_GL, BUDGET_SUMMARY } from '../extract/fileType.js'
import { resolveScore } from './accountResolve.js'

export const CONFIDENCE_FLOOR = 0.6
export const MAX_CITATIONS_PER_NOTE = 3

// Columns in a supporting file that are likely to carry the account label.
// NQ-6C.1: also recognize common GL header variants — "code" / "GL code",
// "G/L", "ledger", "chart" (of accounts) — that real exports use instead of a
// literal "Account" header. Without these the index silently produced no
// entries whenever the account column was not named "Account".
const ACCOUNT_COL_RE = /account|acct|\bcode\b|ledger|chart|description|\bg\/?l\b|\bname\b|item|line|category/i

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

// NQ-6C.1: columns we may borrow an account LABEL from when the account column
// itself holds only a code (e.g. "6250") or is blank for a row. Description /
// memo / name carry a human-readable account name; vendor/payee deliberately do
// NOT (a counterparty is not an account name and would invite false matches).
const LABEL_FALLBACK_COL_RE = /description|memo|detail|narrative|note|particular|\bname\b/i

// NQ-4B.1a: typed amount columns for the prepared-evidence layer. Debit/Credit
// drive deterministic netting (debit positive, credit negative); a running
// Balance column is captured for traceability but EXCLUDED from transaction
// totals. These are additive — they do not change AMOUNT_COL_RE, reliableAmount,
// or summarizeDetail, so the existing `amount`/`detail` outputs are unchanged.
const DEBIT_COL_RE = /debit|\bdr\b/i
const CREDIT_COL_RE = /credit|\bcr\b/i
const BALANCE_COL_RE = /balance/i

// A leading numeric token used as an account code: "5100", "5100-10", "51.00".
const CODE_RE = /^\s*([0-9][0-9.\-]*[0-9]|[0-9])/

// A leading number only counts as an account CODE when it carries at least this
// many digits. Real chart-of-accounts codes are 4+ digits ("5100", "6250",
// "51300", "5100-10"); shorter leading numbers are part of the label — a benefit
// plan ("401(k) Match") or a street address ("350 Rhode Island CAM") — and
// treating them as codes produced false 1.0 exact-code matches.
const CODE_MIN_DIGITS = 4

// Cells that are purely numeric/symbolic are values, not account labels.
const NUMERIC_ONLY_RE = /^[\s0-9.,$()%\-]+$/

export function accountCode(label = '') {
  const s = String(label)
  const m = s.match(CODE_RE)
  if (!m) return ''
  // The token must be separated from the label text: digits running straight
  // into "(" ("401(k) Match") or a letter are a name fragment, never a code.
  const rest = s.slice(m[0].length)
  if (/^[A-Za-z(]/.test(rest)) return ''
  const digits = (m[1].match(/[0-9]/g) || []).length
  if (digits < CODE_MIN_DIGITS) return ''
  return m[1].replace(/[.\-]+$/, '')
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
    // NQ-6C.2: a budget summary confirms variance only — it carries no
    // transaction detail, vendor, or memo, so it contributes no GL evidence rows.
    if (normalized.fileType === BUDGET_SUMMARY) continue
    const rows = Array.isArray(normalized.rows) ? normalized.rows : []
    if (rows.length === 0) continue

    const columns = Array.isArray(normalized.columns) ? normalized.columns : []
    const col = chooseAccountColumn(columns, rows)

    // Pre-resolve which columns (other than the account column) carry an amount
    // or a description/reference, so per-row thickness is a cheap lookup.
    const amountCols = []
    const detailCols = []
    const vendorCols = []
    const descCols = []
    // NQ-6C.1: columns to borrow an account label from when the account cell is
    // a bare code or blank.
    const labelFallbackCols = []
    // NQ-4B.1a: typed debit / credit / balance columns (additive).
    const debitCols = []
    const creditCols = []
    const balanceCols = []
    for (let i = 0; i < columns.length; i++) {
      if (i === col) continue
      const h = String(columns[i])
      if (AMOUNT_COL_RE.test(h)) amountCols.push(i)
      if (DETAIL_COL_RE.test(h)) detailCols.push(i)
      if (VENDOR_COL_RE.test(h)) vendorCols.push(i)
      if (DESC_COL_RE.test(h)) descCols.push(i)
      if (LABEL_FALLBACK_COL_RE.test(h)) labelFallbackCols.push(i)
      // A Balance column is checked first so a "Debit"/"Credit" header never also
      // lands in balanceCols and vice-versa (the three are mutually exclusive).
      if (BALANCE_COL_RE.test(h)) balanceCols.push(i)
      else if (DEBIT_COL_RE.test(h)) debitCols.push(i)
      else if (CREDIT_COL_RE.test(h)) creditCols.push(i)
    }

    const fileName = ex.fileName || ''
    // NQ-6C.2: a content-detected sectioned GL is GL evidence regardless of the
    // filename-based classification, so the GL commentary path engages for it
    // even when the file was not named like a ledger.
    const classificationType =
      normalized.fileType === SECTIONED_GL
        ? 'General Ledger (GL)'
        : (ex.classification && ex.classification.type) || 'Supporting Document'

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      if (!Array.isArray(row)) continue
      const resolved = resolveRowLabel(row, col, labelFallbackCols)
      if (!resolved) continue
      const { label, code } = resolved
      const normName = normalizeName(label)
      if (!normName) continue
      entries.push({
        fileName,
        classificationType,
        label,
        code,
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
        descText: firstDetailText(row, descCols),
        // NQ-4B.1a: typed transaction amounts for the prepared-evidence layer.
        // Balance is captured but never summed into a transaction total.
        debit: typedAmount(row, debitCols),
        credit: typedAmount(row, creditCols),
        balance: typedAmount(row, balanceCols)
      })
    }
  }

  return entries
}

// Choose the column that carries the account label. Among headers that look
// account-like, prefer the one whose cells are predominantly names (contain
// letters) over a code-only column — so "Account No" (codes) never wins over
// "Account Name". Ties keep the earliest column (deterministic, and identical to
// the prior findIndex behavior when only one header matches). Falls back to the
// first column when no header looks account-like.
function chooseAccountColumn(columns, rows) {
  const candidates = []
  for (let i = 0; i < columns.length; i++) {
    if (ACCOUNT_COL_RE.test(String(columns[i]))) candidates.push(i)
  }
  if (candidates.length === 0) return 0
  if (candidates.length === 1) return candidates[0]
  let best = candidates[0]
  let bestScore = columnNameScore(rows, best)
  for (let k = 1; k < candidates.length; k++) {
    const score = columnNameScore(rows, candidates[k])
    if (score > bestScore) {
      best = candidates[k]
      bestScore = score
    }
  }
  return best
}

// Fraction of a column's non-empty cells that look like names (contain a letter,
// i.e. are not purely numeric/symbolic). 0 when the column has no data, so an
// empty column never wins over one that actually carries names.
function columnNameScore(rows, col) {
  let named = 0
  let nonEmpty = 0
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const v = String(row[col] ?? '').trim()
    if (!v) continue
    nonEmpty++
    if (!NUMERIC_ONLY_RE.test(v)) named++
  }
  return nonEmpty === 0 ? 0 : named / nonEmpty
}

// Resolve the account label for one row. Normally the account column carries it.
// But many GL exports put a bare code (e.g. "6250") — or nothing — in the account
// column and keep the human-readable account in a description / memo / name
// column. NQ-6C.1: in that case borrow the first text label from those columns so
// the row still indexes by name (otherwise it was silently dropped and the
// account never matched). Returns { label, code } or null when no usable text
// exists anywhere on the row.
function resolveRowLabel(row, accountCol, labelFallbackCols) {
  const primary = String(row[accountCol] ?? '').trim()
  if (primary && !NUMERIC_ONLY_RE.test(primary)) {
    return { label: primary, code: accountCode(primary) }
  }
  const fallback = firstDetailText(row, labelFallbackCols)
  if (!fallback) return null
  // A bare numeric code in the account column is still useful for code-tier
  // matching; otherwise derive the code from the borrowed label as usual.
  return { label: fallback, code: accountCode(primary) || accountCode(fallback) }
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

// NQ-4B.1a: the first reliably-parsed number among a set of typed columns
// (debit / credit / balance), or null when none parses. A single typed column
// is the normal case; first-non-null keeps it deterministic if a layout repeats.
function typedAmount(row, cols) {
  for (const i of cols) {
    const n = toNumber(row[i])
    if (n !== null) return n
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
//   { count, total, maxTxn, topVendor, topVendorCount, signed }
// total is the summed amount ONLY when every matched row contributed a reliable
// amount (otherwise null, so we never present a partial/ambiguous total).
// topVendor is the most frequent description/vendor across matched rows (ties
// broken by first appearance), or null when none carries text.
//
// `signed` (bug fix, GL sign-convention) — true only when at least one matched
// row carried a genuinely TYPED Debit or Credit value (see DEBIT_COL_RE /
// CREDIT_COL_RE above), i.e. the source file distinguishes which way a
// transaction moved the account, not just its size. A single generic "Amount"
// column carries no such evidence: many real GL exports simply record a
// positive transaction size regardless of which way it moved the account
// (common for revenue postings), so its sign cannot be trusted to mean
// "debit"/"credit" in the accounting sense. Consumers (contribution.js) use
// this to decide whether a sign-based direction check is trustworthy.
function summarizeDetail(rows) {
  const count = rows.length
  let total = 0
  let amountsSeen = 0
  let maxTxn = null
  let signed = false

  for (const row of rows) {
    if (typeof row.amount === 'number' && Number.isFinite(row.amount)) {
      total += row.amount
      amountsSeen++
      const mag = Math.abs(row.amount)
      if (maxTxn === null || mag > maxTxn) maxTxn = mag
    }
    if (
      (typeof row.debit === 'number' && Number.isFinite(row.debit)) ||
      (typeof row.credit === 'number' && Number.isFinite(row.credit))
    ) {
      signed = true
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
    description,
    signed
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

// Score one base account against one index entry, returning BOTH the 0..1 score
// and the `matchMethod` tier that produced it (NQ-4C.1):
//   'exact_code' | 'exact_name' | 'substring' | 'resolved_equal' |
//   'resolved_subset' | null (sub-floor token overlap — never cited)
export function scoreMatchDetailed(baseAccount, entry) {
  const baseCode = accountCode(baseAccount)
  const baseNorm = normalizeName(baseAccount)
  if (!baseNorm) return { score: 0, method: null }
  const baseTokens = tokensOf(baseNorm)

  // 1) Exact account code.
  if (baseCode && entry.code && baseCode === entry.code) return { score: 1.0, method: 'exact_code' }
  // Contradicting explicit codes: when BOTH sides carry a code and they differ,
  // they are different chart accounts no matter how similar the names read
  // ("6010 Repairs & Maintenance" vs "7010 Repairs & Maintenance" — normalizeName
  // strips the codes), so no name-based tier may fire.
  if (baseCode && entry.code && baseCode !== entry.code) return { score: 0, method: null }
  // 2) Exact normalized name.
  if (baseNorm === entry.normName) return { score: 0.9, method: 'exact_name' }
  // 3) Conservative substring containment, guarded so short/single-word labels
  //    (e.g. "tax") cannot match a longer unrelated account.
  if (
    baseNorm.length >= 5 &&
    entry.normName.length >= 5 &&
    baseTokens.length >= 2 &&
    entry.tokens.length >= 2 &&
    (entry.normName.includes(baseNorm) || baseNorm.includes(entry.normName))
  ) {
    return { score: 0.7, method: 'substring' }
  }
  // 4) NQ-4C.1: deterministic account resolution (qualifier-aware significant-
  //    token subset, guarded). Runs AFTER the exact/substring tiers so every
  //    existing citation is unchanged, and BEFORE the sub-floor fallback so only
  //    previously-unmatched pairs can newly resolve.
  const resolved = resolveScore(baseAccount, entry)
  if (resolved.score > 0) return resolved
  // 5) Partial token overlap — deliberately scaled below the floor so a partial
  //    resemblance is scored but never attached on its own.
  const baseSet = new Set(baseTokens)
  let shared = 0
  for (const t of new Set(entry.tokens)) if (baseSet.has(t)) shared++
  const denom = Math.max(baseTokens.length, entry.tokens.length, 1)
  return { score: 0.6 * (shared / denom), method: null }
}

// Match one flagged account to supporting evidence. Returns a deterministic,
// deduped, capped list of citations:
//   [{ fileName, classificationType, confidence, sourceRows, thick, detail }]
// One citation per file, holding ONLY the rows of that file's best-scoring
// account entry (see below), ordered by confidence then evidence richness, with
// file name as the deterministic tiebreaker. `thick` is true when ANY matched
// row in the citation carried usable amount/description detail. `detail` is the
// Phase 17 GL-detail summary over the citation's matched rows.
export function matchAccount(account, index = [], options = {}) {
  const floor = Number.isFinite(options.floor) ? options.floor : CONFIDENCE_FLOOR
  const cap = Number.isFinite(options.cap) ? options.cap : MAX_CITATIONS_PER_NOTE
  if (!account || !Array.isArray(index) || index.length === 0) return []

  // Group matched entries per file AND per account identity — the entry's code
  // when it has one, else its normalized name. Merging EVERY above-floor entry
  // of a file into one rows map summed transactions from DIFFERENT GL accounts
  // (and "Total …" roll-up rows admitted by the substring tier) into a single
  // citation total, double-counting owner-visible dollars.
  const byGroup = new Map()
  for (const entry of index) {
    const { score, method } = scoreMatchDetailed(account, entry)
    if (score < floor) continue
    const identity = entry.code ? `code:${entry.code}` : `name:${entry.normName}`
    const key = `${entry.fileName}\u0000${identity}`
    let existing = byGroup.get(key)
    if (!existing) {
      existing = {
        fileName: entry.fileName,
        classificationType: entry.classificationType,
        confidence: score,
        // NQ-4C.1: the tier that produced this account entry's best (highest) score.
        matchMethod: method,
        thick: false,
        // First source row of the group — the deterministic tiebreaker when two
        // same-file account entries score identically.
        firstRow: entry.sourceRow,
        // Dedupe matched rows by source-row index, so a repeated identical row
        // can never inflate the count or total.
        rows: new Map()
      }
      byGroup.set(key, existing)
    }
    // Track the method of the highest-scoring matched row for this account; ties
    // keep the first-seen method (deterministic).
    if (score > existing.confidence) {
      existing.confidence = score
      existing.matchMethod = method
    }
    existing.thick = existing.thick || !!entry.hasDetail
    if (!existing.rows.has(entry.sourceRow)) {
      existing.rows.set(entry.sourceRow, {
        amount: entry.amount,
        detailText: entry.detailText,
        vendorText: entry.vendorText,
        descText: entry.descText,
        // NQ-4B.1a: typed transaction amounts carried through for prepared evidence.
        debit: entry.debit,
        credit: entry.credit,
        balance: entry.balance
      })
    }
  }

  // One citation per file: keep only the BEST-scoring account group (ties prefer
  // thick evidence, then the earliest source row — deterministic), so a
  // citation's rows always belong to one genuine account and a roll-up row is
  // never summed together with the detail rows it rolls up.
  const byFile = new Map()
  for (const group of byGroup.values()) {
    const best = byFile.get(group.fileName)
    if (
      !best ||
      group.confidence > best.confidence ||
      (group.confidence === best.confidence && group.thick && !best.thick) ||
      (group.confidence === best.confidence && group.thick === best.thick && group.firstRow < best.firstRow)
    ) {
      byFile.set(group.fileName, group)
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
        // NQ-4C.1: additive metadata — which tier matched this file.
        matchMethod: c.matchMethod,
        sourceRows,
        thick: c.thick,
        detail: summarizeDetail(orderedRows),
        // NQ-4B.1a: per-row typed cells (source-row traceable), consumed by the
        // prepared-evidence layer. Additive metadata — no template reads this.
        matchedRows: sourceRows.map((r) => ({ sourceRow: r, ...c.rows.get(r) }))
      }
    })
    .sort((a, b) => {
      // Best evidence first — confidence, then richness (thick amount/description
      // detail beats a name-only match) — so the cap never drops an exact-code GL
      // citation in favor of weaker matches that merely sort earlier by file name.
      if (b.confidence !== a.confidence) return b.confidence - a.confidence
      if (a.thick !== b.thick) return a.thick ? -1 : 1
      const byName = a.fileName.localeCompare(b.fileName)
      if (byName !== 0) return byName
      return (a.sourceRows[0] ?? 0) - (b.sourceRows[0] ?? 0)
    })
    .slice(0, cap)
}
