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
import { isRollupLabel } from '../variance/sectionType.js'
import { isZeroNoiseVariance } from '../variance/thresholds.js'
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
export function byMateriality(a, b) {
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
  // Phase 17: carry the raw actual and comparison (budget or prior) figures as
  // structured metadata so the Excel export can populate Actual / Budget-Prior
  // columns. Additive only — it changes no wording, no variance math, and no
  // existing field, so Markdown/DOCX output stays byte-identical.
  const comparison = c.comparisonType === 'prior' ? c.prior : c.budget
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
    variancePercent: c.variancePercent,
    actual: c.actual ?? null,
    comparison: comparison ?? null
  }
}

// Statement rollup / subtotal lines (e.g. "NET INCOME", "TOTAL EXPENSES",
// "GROSS PROFIT", "SUBTOTAL …") are aggregates of the real account lines beneath
// them — narrating them double-counts and crowds the owner's watch-list with
// totals rather than accounts. Phase 20A.1 keeps them OUT of owner-facing notes.
//
// Detection is conservative and deterministic: the label must START with one of
// those keywords AND must NOT be a normal coded account line (real accounts here
// carry a leading numeric code, e.g. "54110 Real Estate Taxes"). This never
// suppresses a coded account, and never suppresses a named account that merely
// contains one of the words later (e.g. "Internet Expense"). Source rows and
// variance figures are untouched — this is presentation only.
//
// Leading spaces / asterisks / bullets are stripped first, aligning with
// sectionType.js SECTION_TOTAL_RE — real exports (e.g. MRI) print subtotals
// like "** TOTAL OTHER INCOME". NET/GROSS labels only count as roll-ups for
// GENUINE aggregate phrases (shared isNetGrossRollup): "Gross Potential Rent"
// and "Gross Scheduled Income" are standard DETAIL income lines on commercial
// property statements and must stay narratable.
// QA fix: this now DELEGATES to the variance engine's isRollupLabel so both
// layers share one definition. The local copy lacked the NET_TOTAL cases —
// bare "NOI" and "GRAND TOTAL" rows were treated as rollups by the engine but
// as real lines here, so the Excel status column labeled them "Within
// Threshold" (factually wrong for a $4,000 movement) instead of "Total".
export { isRollupLabel }

// NQ-2C — ZERO_NOISE suppression.
// A variance whose absolute dollar movement is below this floor is "effectively
// zero" — it renders as "$0" / "$0.09" noise that tells an owner nothing. Such
// a row may still have crossed the PERCENT threshold (a tiny base yields a huge
// percent on a sub-dollar move). The canonical floor now lives in the variance
// layer (thresholds.js) and the ENGINE clears the trigger for these rows, so
// the flagged count, the executive sentence, and this narrative filter all
// agree; the re-export (and the belt-and-suspenders filter in triggeredRows)
// keep every existing consumer working unchanged.
export { isZeroNoiseVariance }
export { ZERO_NOISE_DOLLAR } from '../variance/thresholds.js'

// Rows that crossed a threshold, by definition the only ones we narrate. Phase
// 20A.1: statement rollups/subtotals are excluded from every owner-facing
// section (high/revenue/expense notes and the executive summary count/total) so
// the narrative reflects real account lines, not double-counted aggregates.
// NQ-2C: effectively-zero (sub-$1) variances are also excluded so "$0"/"$0.09"
// noise never reaches the narrative. Both filters are presentation-only — they
// change no variance figure and no source-row index.
export function triggeredRows(comparisons) {
  return comparisons.filter(
    (c) => c && c.thresholdTriggered && !isRollupLabel(c.account) && !isZeroNoiseVariance(c)
  )
}

// NQ-1B — Section de-duplication.
// Headline size for the High Variances section. The High Variances list is now a
// CONCISE headline of the top material drivers across the whole report, not a
// repeat of every triggered row. The N most material triggered rows (by absolute
// dollar movement) lead High Variances and are NOT relisted in Revenue/Expense
// Notes; every other triggered revenue/expense row lives ONLY in its category
// note. So a variance appears exactly once. (Untyped rows have no category note,
// so they always remain in High Variances — see buildHighVariances.)
export const HIGH_VARIANCE_HEADLINE_LIMIT = 3

// The headline set: the N most material triggered rows across the whole report,
// chosen deterministically by materiality. Returned as a Set of the original
// comparison object references. buildPeriodNarrative hands the SAME `comparisons`
// array to every section builder, so identity membership is stable and the three
// sections always agree on which rows were promoted to the headline.
export function headlineSet(comparisons) {
  const ranked = triggeredRows(comparisons).slice().sort(byMateriality)
  return new Set(ranked.slice(0, HIGH_VARIANCE_HEADLINE_LIMIT))
}

// A row is "category-owned" when a dedicated notes section (Revenue or Expense)
// can hold it. Untyped/unknown rows are not category-owned, so High Variances is
// their only possible home and they are never dropped from it.
export function isCategoryOwned(c) {
  return c.accountType === 'revenue' || c.accountType === 'expense'
}

// --- NQ-3B: plan-driven section selection ----------------------------------
// The owner-facing notes are now SELECTED from the deterministic commentary plan
// (period.plan, built in generateNarrative) instead of recomputed from raw
// comparisons. The plan's disposition / materiality / theme / ownerQuestion
// decide membership; sentence generation is unchanged — every selected row is
// still rendered by the same toNote(), so wording, figures, and ordering match.
//
// Plan items carry only decisions plus a stable id, so each selected item is
// mapped back to its source comparison to render. The id mirrors the plan's own
// `${account}#${firstSourceRow}` scheme (commentaryPlan.js) over the same filtered
// rows, so the mapping is exact and needs no import of the plan module (avoiding a
// cycle — generateNarrative computes the plan and hands it in).
function comparisonId(c, index) {
  const account = String(c.account || '').trim()
  const firstRow = Array.isArray(c.sourceRows) && c.sourceRows.length > 0 ? c.sourceRows[0] : index
  return `${account}#${firstRow}`
}

function indexComparisons(comparisons) {
  const rows = (Array.isArray(comparisons) ? comparisons : []).filter((c) => c && typeof c === 'object')
  const map = new Map()
  rows.forEach((c, i) => {
    const id = comparisonId(c, i)
    if (!map.has(id)) map.set(id, c)
  })
  return map
}

// Select the comparison rows whose plan item satisfies `match(item, comparison)`,
// render each with the unchanged toNote(), and order with `sort`. With no plan
// (a defensive default), no rows are selected.
function notesFromPlan(comparisons, plan, match, sort) {
  const items = plan && Array.isArray(plan.items) ? plan.items : []
  const byId = indexComparisons(comparisons)
  return items
    .map((item) => ({ item, c: byId.get(item.id) }))
    .filter(({ item, c }) => c && match(item, c))
    .map(({ c }) => c)
    .slice()
    .sort(sort)
    .map((c) => toNote(c))
}

// Grouped EXPENSE themes kept OUT of Expense Notes (NQ-3B): timing/balance-sheet
// and non-cash lines are not operating-expense commentary, and revenue/leasing
// lines belong to Revenue Notes. They have dedicated handling elsewhere.
const EXPENSE_EXCLUDED_THEMES = new Set(['timing_balance_sheet', 'non_cash', 'revenue_leasing'])

// Grouped REVENUE themes kept OUT of Revenue Notes: timing/balance-sheet and
// non-cash lines are not operating-revenue commentary (mirrors the expense
// side). Everything else revenue-typed — including 'recoveries' (e.g. a CAM or
// tax recovery INCOME line) and other keyword-matched themes (taxes, utilities,
// …) — belongs in Revenue Notes. Previously this section required the theme to
// be exactly 'revenue_leasing', so any revenue-typed line whose account name
// happened to match an operating-expense-style theme keyword (e.g. "Recovery",
// "Tax", "Utility") was silently re-homed to Context Notes with no dedicated
// handling there, even though it is ordinary flagged revenue commentary a
// reader would expect under Revenue Notes (bug fix).
const REVENUE_EXCLUDED_THEMES = new Set(['timing_balance_sheet', 'non_cash'])

// --- Section membership predicates (single source of truth) ----------------
// The four owner-prose sections that hold variance lines are defined by these
// pairwise-disjoint predicates over the plan item (and its source comparison).
// Defining them ONCE guarantees Context Notes is the EXACT complement, so every
// triggered non-rollup row lands in exactly one prose section (NQ-3C invariants A
// and B). High Variances requires `individual`; Revenue/Expense require `grouped`,
// so they can never overlap; Revenue vs Expense are split by accountType.
const matchHighVariance = (i) =>
  i.disposition === 'individual' && (i.materiality === 'top_driver' || i.materiality === 'material')
const matchRevenueNote = (i, c) =>
  i.disposition === 'grouped' && !REVENUE_EXCLUDED_THEMES.has(i.theme) && c.accountType === 'revenue'
const matchExpenseNote = (i, c) =>
  i.disposition === 'grouped' && !EXPENSE_EXCLUDED_THEMES.has(i.theme) && c.accountType === 'expense'

// A row the narrative may discuss: it crossed a threshold and is a real account
// line (disposition is individual or grouped; rollups and suppressed rows are not).
const isTriggeredItem = (i) => i.disposition === 'individual' || i.disposition === 'grouped'

// High Variances — the individual-disposition drivers (top_driver or material).
// Same headline/untyped set as before; immaterial/noise rows are never promoted.
export function buildHighVariances(comparisons, plan) {
  return notesFromPlan(comparisons, plan, matchHighVariance, byOwnerPriority)
}

// Revenue Notes — grouped revenue lines in the revenue/leasing theme, most
// material first. (A revenue line promoted to High Variances is not repeated.)
export function buildRevenueNotes(comparisons, plan) {
  return notesFromPlan(comparisons, plan, matchRevenueNote, byMateriality)
}

// Expense Notes — grouped expense lines, excluding timing/balance-sheet, non-cash,
// and revenue/leasing themes (NQ-3B). Most material first.
export function buildExpenseNotes(comparisons, plan) {
  return notesFromPlan(comparisons, plan, matchExpenseNote, byMateriality)
}

// Context Notes (NQ-3C, NEW) — the catch-all: every triggered, non-rollup row that
// the three sections above did NOT place. This RE-HOMES grouped timing/balance-sheet
// and non-cash expense lines (excluded from Expense Notes), plus any other orphan
// (e.g. an immaterial individual line, or a theme-mismatched grouped line) so no
// counted variance is left unnarrated (NQ-3C reconciliation). Selection only — rows
// are rendered with the same toNote() wording; nothing is synthesized. Most material
// first.
export function buildContextNotes(comparisons, plan) {
  return notesFromPlan(
    comparisons,
    plan,
    (i, c) => isTriggeredItem(i) && !matchHighVariance(i, c) && !matchRevenueNote(i, c) && !matchExpenseNote(i, c),
    byMateriality
  )
}

// Review Items (NQ-3B) — triggered rows the plan flags for a closer look
// (ownerQuestion === WHAT_TO_CHECK): material, unexplained lines. Selection only —
// rows are rendered with the same toNote() wording and intentionally OVERLAP their
// primary section (NQ-3C invariant C). Still INERT in NQ-3C: no surface renders it.
export function buildReviewItems(comparisons, plan) {
  return notesFromPlan(
    comparisons,
    plan,
    (i) => isTriggeredItem(i) && i.ownerQuestion === 'WHAT_TO_CHECK',
    byOwnerPriority
  )
}

// The COMPLETE variance table for export (Phase 21.6 bugfix). Every comparison
// row from the base report — in source order — carrying the structured figures
// plus flags. The threshold governs ONLY whether a row is narrated/commented
// (`thresholdTriggered`), never whether it appears here, so the Excel export can
// list every line of the base report (below-threshold rows with a blank
// narrative). This is presentation metadata for the export; the owner-facing
// narrative sections (High Variances, etc.) are unchanged. Rollup/subtotal lines
// are flagged so the export can label them without narrating them.
export function buildAllVariances(comparisons) {
  return (Array.isArray(comparisons) ? comparisons : [])
    .filter((c) => c && typeof c === 'object')
    .map((c) => {
      const comparison = c.comparisonType === 'prior' ? c.prior : c.budget
      return {
        account: c.account || '',
        sourceRows: sourceRowsOf(c),
        actual: c.actual ?? null,
        comparison: comparison ?? null,
        varianceAmount: c.varianceAmount ?? null,
        variancePercent: c.variancePercent ?? null,
        category: c.category,
        accountType: c.accountType,
        comparisonType: c.comparisonType,
        // A row is narrated only when it crossed a threshold AND is a real account
        // line (statement rollups are excluded from owner notes — see below).
        thresholdTriggered: !!c.thresholdTriggered && !isRollupLabel(c.account),
        rollup: isRollupLabel(c.account),
        missingData: !!c.missingData
      }
    })
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
  // Reconciliation invariant: the headline count and its (unfavorable, favorable)
  // parenthetical must always agree. Favorability is section-driven, so every
  // counted line lands in exactly one bucket — favorable or unfavorable. Rows
  // with no income-statement side (category 'neutral' — e.g. capital-expenditure
  // detail or bottom-line lines that roll into neither a revenue nor an expense
  // subtotal) carry no favorability opinion; they were the lines previously
  // counted in the total yet absent from the split, so the parenthetical failed
  // to sum. The exec summary now counts and totals EXACTLY the directional rows,
  // guaranteeing favorable + unfavorable === count by construction.
  const directional = triggered.filter(
    (c) => c.category === 'favorable' || c.category === 'unfavorable'
  )
  const total = directional.reduce((sum, c) => sum + Math.abs(c.varianceAmount ?? 0), 0)
  const favorable = directional.filter((c) => c.category === 'favorable').length
  const unfavorable = directional.filter((c) => c.category === 'unfavorable').length
  const count = favorable + unfavorable

  const sourceRows = unionSourceRows(directional)
  const thresholdAmount = formatMoney(thresholds.amount ?? 0)
  const thresholdPercent = `${thresholds.percent ?? 0}%`

  // One owner-ready sentence. The revenue/expense breakdown lives in the
  // dedicated Revenue/Expense Notes sections, so it is not repeated here.
  const lead = {
    text: executiveSentence({
      period,
      count,
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
