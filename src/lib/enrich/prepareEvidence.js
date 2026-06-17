// --- Prepared evidence metadata — NQ-4B.1a --------------------------------
// A pure, post-matching layer that PREPARES supporting GL evidence for later
// commentary, WITHOUT changing anything an owner sees today. It sits between
// supporting-file matching and narrative wording:
//
//   extract → match → summarize → reconstruct → select → PREPARE (this) → [future wording]
//
// Naming: this is `preparedEvidence`, not `preparedVariance`. The base /
// comparative report remains the single source of variance TRUTH — supporting
// files only PREPARE evidence for commentary. So this module never recomputes a
// variance, never invents a figure, and is attached as additive metadata only.
//
// What it does (NQ-4B.1a scope, narrow):
//   • Captures the matched GL rows (source-row traceable): debit, credit,
//     balance, the netted transaction amount, and any already-available
//     vendor / memo cue.
//   • Nets debit/credit deterministically — debit positive, credit negative,
//     netAmount = debit − credit.
//   • EXCLUDES a running Balance column from every transaction total.
//   • Rolls up netTotal / maxTxn / transactionCount / amountReliable /
//     columnModel / balanceExcluded.
//   • Carries the top contributors (largest by absolute net amount) with a
//     render-safe vendor / memo cue when one is available.
//
// Hard boundaries: pure & deterministic; NO AI/LLM, NO network, NO variance
// math, NO rendering. NOTHING here reaches owner narrative text in NQ-4B.1a —
// no wording module consumes it yet.

import { reconstructDetail } from './reconstructDetail.js'
import { selectDetailEvidence } from './detailEvidence.js'

// How many top contributors to carry (largest absolute net amount first).
export const TOP_CONTRIBUTORS_MAX = 3

function num(x) {
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

// A render-safe vendor / memo cue for one row, reusing the existing
// reconstruction (21.1) + selection (21.2) gates rather than reimplementing
// any sanitation. Returns { vendor, memo } — either may be null. Nothing here
// is rendered; the safety gating is reused so a future wording layer can trust
// these cues without re-deriving them.
function safeCue(row, account) {
  const reconstructed = reconstructDetail({
    vendor: row.vendorText || '',
    description: row.descText || '',
    account
  })
  const ev = selectDetailEvidence({ reconstructed, account })
  return { vendor: ev.vendor, memo: ev.memo }
}

// Prepare evidence for ONE enriched note from its primary GL citation.
//   note     — the flagged variance note (account is used for cue gating only).
//   citation — a matchAccount() result carrying `matchedRows` (per-row typed
//              cells). When absent/empty the result is an honest empty shape.
export function prepareEvidence({ note = {}, citation = {} } = {}) {
  const account = note.account || ''
  const rows = Array.isArray(citation.matchedRows) ? citation.matchedRows : []

  // Column model is a file-level property of the matched rows:
  //   debit-credit  — any debit/credit value is present → net debit − credit
  //   single-amount — a lone unambiguous amount column, with NO Balance column
  //   unresolved    — no trustworthy transaction amount available
  // A running Balance column is never a transaction amount, so when it is the
  // only amount-ish column present the model is unresolved (balance excluded).
  const balanceColumnPresent = rows.some((r) => num(r.balance) !== null)
  const hasDebitCredit = rows.some((r) => num(r.debit) !== null || num(r.credit) !== null)
  const hasSingleAmount =
    !hasDebitCredit && !balanceColumnPresent && rows.some((r) => num(r.amount) !== null)
  const columnModel = hasDebitCredit ? 'debit-credit' : hasSingleAmount ? 'single-amount' : 'unresolved'

  // Per-row capture. netAmount is null when the row carries no trustworthy
  // transaction amount under the resolved column model (a partial row), so a
  // partial population is visible rather than silently summed.
  const glRows = rows.map((row) => {
    const debit = num(row.debit)
    const credit = num(row.credit)
    const balance = num(row.balance)
    let netAmount = null
    if (columnModel === 'debit-credit') {
      if (debit !== null || credit !== null) netAmount = (debit || 0) - (credit || 0)
    } else if (columnModel === 'single-amount') {
      netAmount = num(row.amount)
    }
    return {
      sourceRow: row.sourceRow,
      debit,
      credit,
      balance,
      netAmount,
      // Raw cues already available on the row (best-effort; may be null).
      vendor: row.vendorText || null,
      memo: row.descText || null
    }
  })

  const netRows = glRows.filter((r) => r.netAmount !== null)
  const transactionCount = netRows.length

  let netTotal = null
  let maxTxn = null
  for (const r of netRows) {
    netTotal = (netTotal === null ? 0 : netTotal) + r.netAmount
    const mag = Math.abs(r.netAmount)
    if (maxTxn === null || mag > maxTxn) maxTxn = mag
  }

  // Reliable only when the model resolved AND every matched row contributed a
  // netted amount (mirrors summarizeDetail's all-or-nothing reliability rule).
  const amountReliable =
    columnModel !== 'unresolved' && glRows.length > 0 && transactionCount === glRows.length

  // Top contributors: largest absolute net amount first, ties broken by source
  // row for determinism. Safe vendor / memo cue attached when one survives.
  const topContributors = [...netRows]
    .sort((a, b) => {
      const byMag = Math.abs(b.netAmount) - Math.abs(a.netAmount)
      if (byMag !== 0) return byMag
      return a.sourceRow - b.sourceRow
    })
    .slice(0, TOP_CONTRIBUTORS_MAX)
    .map((r) => {
      const cue = safeCue({ vendorText: r.vendor, descText: r.memo }, account)
      return { sourceRow: r.sourceRow, netAmount: r.netAmount, vendor: cue.vendor, memo: cue.memo }
    })

  return {
    account,
    glRows,
    netTotal,
    maxTxn,
    transactionCount,
    amountReliable,
    columnModel,
    balanceExcluded: balanceColumnPresent,
    topContributors
  }
}
