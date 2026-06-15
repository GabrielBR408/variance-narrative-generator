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
  executiveSentence,
  executiveSplitSentence
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

function toNote(c, period) {
  return {
    text: varianceSentence({
      account: c.account,
      comparisonType: c.comparisonType,
      varianceAmount: c.varianceAmount,
      variancePercent: c.variancePercent,
      period
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

// High Variances — every triggered row, most material first.
export function buildHighVariances(comparisons, period) {
  return triggeredRows(comparisons).slice().sort(byMateriality).map((c) => toNote(c, period))
}

// Revenue Notes — triggered revenue lines only.
export function buildRevenueNotes(comparisons, period) {
  return triggeredRows(comparisons)
    .filter((c) => c.accountType === 'revenue')
    .slice()
    .sort(byMateriality)
    .map((c) => toNote(c, period))
}

// Expense Notes — triggered expense lines only.
export function buildExpenseNotes(comparisons, period) {
  return triggeredRows(comparisons)
    .filter((c) => c.accountType === 'expense')
    .slice()
    .sort(byMateriality)
    .map((c) => toNote(c, period))
}

// Missing Data — rows that could not be fully compared. Reported, never
// assumed. Kept in source order so the list mirrors the statement.
export function buildMissingData(comparisons, period) {
  return comparisons
    .filter((c) => c && c.missingData)
    .map((c) => {
      const hasActual = c.actual !== null && c.actual !== undefined
      const hasComparison =
        (c.budget !== null && c.budget !== undefined) ||
        (c.prior !== null && c.prior !== undefined)
      return {
        text: missingSentence({ account: c.account, hasActual, hasComparison, period }),
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
  const revenueCount = triggered.filter((c) => c.accountType === 'revenue').length
  const expenseCount = triggered.filter((c) => c.accountType === 'expense').length

  const sourceRows = unionSourceRows(triggered)
  const thresholdAmount = formatMoney(thresholds.amount ?? 0)
  const thresholdPercent = `${thresholds.percent ?? 0}%`

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

  const notes = [lead]
  const splitText = executiveSplitSentence({ revenueCount, expenseCount })
  if (splitText) notes.push({ text: splitText, sourceRows })
  return notes
}

// Sorted, de-duplicated union of source-row indices across a set of records.
export function unionSourceRows(records) {
  const set = new Set()
  for (const r of records) for (const i of sourceRowsOf(r)) set.add(i)
  return [...set].sort((a, b) => a - b)
}
