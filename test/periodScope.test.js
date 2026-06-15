// Period-scope view-filter tests — Phase 15.1.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Covers the deterministic narrative period-scope selector: Current-only,
// YTD-only, Both (default, identity-preserving), the single-period case that
// keeps current behavior (control hidden/disabled), that Phase 15 supporting-
// file enrichment survives scope filtering, and that Markdown/DOCX exports stay
// in lockstep with the selected scope.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { generateNarrative } from '../src/lib/narrative/index.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'
import { narrativeToDocxBlocks } from '../src/lib/export/docx.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'
import {
  scopeNarrative,
  periodScopeAvailable,
  hasBothPeriods,
  periodKeys,
  PERIOD_SCOPES,
  DEFAULT_PERIOD_SCOPE,
  PERIOD_SCOPE_LABEL,
  PERIOD_SCOPE_OPTIONS,
  PERIOD_SCOPE_HELP
} from '../src/lib/narrative/periodScope.js'

// --- helpers ---------------------------------------------------------------

// A triggered comparison record matching the variance engine's output shape.
function rec({ account, actual, budget, accountType = 'expense', category = 'unfavorable', sourceRows = [] }) {
  const varianceAmount = actual - budget
  const variancePercent = budget === 0 ? null : (varianceAmount / Math.abs(budget)) * 100
  return {
    account,
    actual,
    budget,
    prior: null,
    varianceAmount,
    variancePercent,
    comparisonType: 'budget',
    thresholdTriggered: Math.abs(varianceAmount) >= 1000 || (variancePercent !== null && Math.abs(variancePercent) >= 10),
    category,
    accountType,
    missingData: false,
    confidence: 90,
    sourceRows
  }
}

// A narrative carrying BOTH a Current and a YTD period.
function twoPeriodNarrative() {
  return generateNarrative({
    fileId: 'base',
    fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [
      { period: 'current', comparisons: [rec({ account: 'Utility Expense Recovery', actual: 12700, budget: 5334, sourceRows: [4] })] },
      { period: 'ytd', comparisons: [rec({ account: 'Utility Expense Recovery', actual: 80000, budget: 64000, sourceRows: [4] })] }
    ]
  })
}

// A narrative carrying only a Current period.
function onePeriodNarrative() {
  return generateNarrative({
    fileId: 'base',
    fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [
      { period: 'current', comparisons: [rec({ account: 'Utility Expense Recovery', actual: 12700, budget: 5334, sourceRows: [4] })] }
    ]
  })
}

// A supporting extraction shaped like the browser's normalized output.
const GL = (fileName = 'General Ledger.pdf') => ({
  fileName,
  status: 'ok',
  classification: { type: 'General Ledger (GL)' },
  normalized: { columns: ['Account', 'Amount'], rows: [['5100 Utility Expense Recovery', '7366']] }
})

// --- selector UI wording (single source of truth, tested as data) ----------

test('selector label and helper text read as specified', () => {
  assert.equal(PERIOD_SCOPE_LABEL, 'Variance Explanation Scope')
  assert.equal(
    PERIOD_SCOPE_HELP,
    'Separate shows Current and YTD independently. Combined will merge duplicate ' +
      'account explanations across periods in a future release.'
  )
})

test('selector options render the right labels, values, and order', () => {
  assert.deepEqual(
    PERIOD_SCOPE_OPTIONS.map((o) => [o.value, o.label]),
    [
      ['current', 'Current Period'],
      ['ytd', 'Year-to-Date'],
      ['both', 'Separate (Current + YTD)'],
      ['combined', 'Combined (Coming Soon)']
    ]
  )
})

test('Combined is the only disabled option, and is not an implemented scope', () => {
  const disabled = PERIOD_SCOPE_OPTIONS.filter((o) => o.disabled).map((o) => o.value)
  assert.deepEqual(disabled, ['combined'])
  // Combined carries no behavior: it is absent from the implemented scope list…
  assert.equal(PERIOD_SCOPES.includes('combined'), false)
  // …and selecting it would be a safe no-op (identity) anyway.
  const n = twoPeriodNarrative()
  assert.equal(scopeNarrative(n, 'combined'), n)
})

test('every selectable (non-disabled) option is an implemented, behavior-backed scope', () => {
  const selectable = PERIOD_SCOPE_OPTIONS.filter((o) => !o.disabled).map((o) => o.value)
  assert.deepEqual([...selectable].sort(), [...PERIOD_SCOPES].sort())
  assert.ok(selectable.includes(DEFAULT_PERIOD_SCOPE))
})

// --- availability gate (control hidden/disabled when only one period) ------

test('hasBothPeriods / periodScopeAvailable: true only with both Current and YTD', () => {
  assert.equal(periodScopeAvailable(twoPeriodNarrative()), true)
  assert.equal(hasBothPeriods(twoPeriodNarrative()), true)
  assert.equal(periodScopeAvailable(onePeriodNarrative()), false)
  assert.equal(hasBothPeriods(onePeriodNarrative()), false)
  assert.deepEqual(periodKeys(twoPeriodNarrative()), ['current', 'ytd'])
})

test('single-period narrative: every scope is a no-op (current behavior preserved, same reference)', () => {
  const n = onePeriodNarrative()
  for (const scope of [...PERIOD_SCOPES, 'combined', 'whatever']) {
    assert.equal(scopeNarrative(n, scope), n, `scope ${scope} must not alter a single-period narrative`)
  }
})

// --- default / both --------------------------------------------------------

test('default scope and "both" return the SAME reference (byte-identical output)', () => {
  const n = twoPeriodNarrative()
  assert.equal(DEFAULT_PERIOD_SCOPE, 'both')
  assert.equal(scopeNarrative(n), n) // default
  assert.equal(scopeNarrative(n, 'both'), n)
  assert.equal(scopeNarrative(n, 'unknown-value'), n) // unknown → unchanged
})

// --- current-only / ytd-only ----------------------------------------------

test('current scope keeps only the Current period', () => {
  const scoped = scopeNarrative(twoPeriodNarrative(), 'current')
  assert.deepEqual(scoped.periods.map((p) => p.period), ['current'])
  assert.equal(scoped.periods[0].periodLabel, 'Current')
  // Metadata untouched; only periods narrowed.
  assert.equal(scoped.fileName, 'Comparative Income Statement.xlsx')
})

test('ytd scope keeps only the YTD period', () => {
  const scoped = scopeNarrative(twoPeriodNarrative(), 'ytd')
  assert.deepEqual(scoped.periods.map((p) => p.period), ['ytd'])
  assert.equal(scoped.periods[0].periodLabel, 'YTD')
})

test('the two scopes partition the periods (no overlap, no loss)', () => {
  const both = twoPeriodNarrative()
  const cur = scopeNarrative(both, 'current').periods.map((p) => p.period)
  const ytd = scopeNarrative(both, 'ytd').periods.map((p) => p.period)
  assert.deepEqual([...cur, ...ytd].sort(), both.periods.map((p) => p.period).sort())
})

// --- enrichment survives scope filtering (Phase 15 preserved) --------------

test('supporting-file enrichment still applies after scope filtering', () => {
  // The app order: enrich first, then scope (a view transform).
  const enriched = enrichNarrative(twoPeriodNarrative(), { supporting: [GL()] })
  const scoped = scopeNarrative(enriched, 'current')

  assert.deepEqual(scoped.periods.map((p) => p.period), ['current'])
  const note = scoped.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  assert.ok(note.enriched, 'enriched explanation must survive the scope filter')
  assert.equal(note.support[0].fileName, 'General Ledger.pdf')
  // Phase 16: an owner-facing explanation merged into the sentence — no file name.
  assert.match(note.text, /shown in the GL detail\.$/)
  assert.doesNotMatch(note.text, /Supporting file|General Ledger\.pdf/)
})

test('scoping an enriched narrative to "both" is still identity', () => {
  const enriched = enrichNarrative(twoPeriodNarrative(), { supporting: [GL()] })
  assert.equal(scopeNarrative(enriched, 'both'), enriched)
})

// --- Markdown / DOCX parity at the selected scope --------------------------

test('Markdown and DOCX agree, and reflect the selected scope', () => {
  const enriched = enrichNarrative(twoPeriodNarrative(), { supporting: [GL()] })

  for (const scope of ['both', 'current', 'ytd']) {
    const scoped = scopeNarrative(enriched, scope)
    const md = narrativeToMarkdown(scoped)
      .split(/^## /m)
      .slice(1)
      .flatMap((chunk) => chunk.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)))
    const dx = narrativeToDocxBlocks(scoped).filter((b) => b.kind === 'bullet').map((b) => b.text)
    assert.deepEqual(md, dx, `Markdown/DOCX bullets must match for scope ${scope}`)
  }

  // Scope actually changes the exported document: YTD heading is present under
  // "both", absent under "current".
  const both = narrativeToMarkdown(scopeNarrative(enriched, 'both'))
  const current = narrativeToMarkdown(scopeNarrative(enriched, 'current'))
  assert.match(both, /## YTD/)
  assert.doesNotMatch(current, /## YTD/)
  assert.match(current, /## Current/)
})
