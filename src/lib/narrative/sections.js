// --- Narrative sections — Phase 9A ----------------------------------------
// Turns one comparison set (the per-period output of the variance engine) into
// the five owner-facing sections. Every rule the spec names lives here:
//
//   • Only discuss triggered rows (high/revenue/expense notes)
//   • Respect favorable/unfavorable (carried straight from the variance record)
//   • Deterministic ordering, highest materiality first
//   • Never invent values — only formats numbers already on the record
//   • Every sentence traceable to its source rows
//
// Each section is an array of "notes": { text, account, sourceRows, ...meta }.
// `meta` carries the raw figures so the UI (or a test) can trace a sentence
// back to the exact record without re-parsing the prose.

import { formatMoney } from './formatters.js'
import {
  varianceSentence,
  missingSentence,
  executiveSentence
} from './templates.js'

function sourceRowsOf(c) {
  return Array.isArray(c.sourceRows) ? c.sourceRows.slice() : []
}

// Materiality ordering: largest dollar movement first, then largest percent,
// then account name, then source-row index. Fully deterministic — the same set
// always yields the same order regardless of input order.
function byMateriality(a, b) {
  const ad = Math.abs(a.varianceAmount ?? 0)
  const bd = Math.abs(b.varianceAmount ?? 0)
  if (bd !== ad) return bd - ad
  const ap = Math.abs(a.variancePercent ?? 0)
  const bp = Math.abs(b.variancePercent ?? 0)
  if (bp !== ap) return bp - ap
  const an = (a.account || '').toLowerCase()
  const bn = (b.account || '').toLowerCase()
  if (an !== bn) return an < bn ? -1 : 1
  return (a.sourceRows?.[0] ?? 0) - (b.sourceRows?.[0] ?? 0)
}

// Owner priority ordering (Phase 14): the High Variances list is the headline
// "what should I worry about" view, so unfavorable movements lead, then
// favorable, with materiality breaking ties within each group. Pure and
// deterministic — only re-groups what byMateriality already orders.
function byOwnerPriority(a, b) {
  const ax = a.category === 'unfavorable' ? 0 : 1
  const bx = b.category === 'unfavorable' ? 0 : 1
  if (ax !== bx) return ax - bx
  return byMateriality(a, b)
}

function toNote(c) {
  return {
    text: varianceSentence({
      account: c.account,
      comparisonType: c.comparisonType,
      varianceAmount: c.varianceAmount,
      variancePercent: c.variancePercent
    }),
    account: c.account || '',
    sourceRows: sourceRowsOf(c),
    category: c.category,
    accountType: c.accountType,
    comparisonType: c.comparisonType,
    varianceAmount: c.varianceAmount,
    variancePercent: c.variancePercent
  }
}

// Rows that crossed a threshold, by definition the only ones we narrate.
function triggeredRows(comparisons) {
  return comparisons.filter((c) => c && c.thresholdTriggered)
}

// High Variances — every triggered row, unfavorable first then favorable, most
// material within each group. This is the owner's "watch list", so problems lead.
export function buildHighVariances(comparisons) {
  return triggeredRows(comparisons).slice().sort(byOwnerPriority).map((c) => toNote(c))
}

// Revenue Notes — triggered revenue lines only, most material first. (Within a
// single account type the dollar movement is the clearest ordering.)
export function buildRevenueNotes(comparisons) {
  return triggeredRows(comparisons)
    .filter((c) => c.accountType === 'revenue')
    .slice()
    .sort(byMateriality)
    .map((c) => toNote(c))
}

// Expense Notes — triggered expense lines only, most material first.
export function buildExpenseNotes(comparisons) {
  return triggeredRows(comparisons)
    .filter((c) => c.accountType === 'expense')
    .slice()
    .sort(byMateriality)
    .map((c) => toNote(c))
}

// Missing Data — rows that could not be fully compared. Reported, never
// assumed. Kept in source order so the list mirrors the statement.
export function buildMissingData(comparisons) {
  return comparisons
    .filter((c) => c && c.missingData)
    .map((c) => {
      const hasActual = c.actual !== null && c.actual !== undefined
      const hasComparison =
        (c.budget !== null && c.budget !== undefined) ||
        (c.prior !== null && c.prior !== undefined)
      return {
        text: missingSentence({ account: c.account, hasActual, hasComparison }),
        account: c.account || '',
        sourceRows: sourceRowsOf(c),
        hasActual,
        hasComparison
      }
    })
}

// Executive Summary — totals of the triggered rows plus the period context.
// Source rows are the union of every triggered row that fed the totals, so the
// headline is as traceable as the lines beneath it.
export function buildExecutiveSummary(comparisons, period, thresholds = {}) {
  const triggered = triggeredRows(comparisons)
  const total = triggered.reduce((sum, c) => sum + Math.abs(c.varianceAmount ?? 0), 0)
  const favorable = triggered.filter((c) => c.category === 'favorable').length
  const unfavorable = triggered.filter((c) => c.category === 'unfavorable').length

  const sourceRows = unionSourceRows(triggered)
  const thresholdAmount = formatMoney(thresholds.amount ?? 0)
  const thresholdPercent = `${thresholds.percent ?? 0}%`

  // One owner-ready sentence. The revenue/expense breakdown lives in the
  // dedicated Revenue/Expense Notes sections, so it is not repeated here.
  const lead = {
    text: executiveSentence({
      period,
      count: triggered.length,
      total: formatMoney(total),
      favorable,
      unfavorable,
      thresholdAmount,
      thresholdPercent
    }),
    sourceRows
  }

  return [lead]
}

// Sorted, de-duplicated union of source-row indices across a set of records.
export function unionSourceRows(records) {
  const set = new Set()
  for (const r of records) for (const i of sourceRowsOf(r)) set.add(i)
  return [...set].sort((a, b) => a - b)
}
