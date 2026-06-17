// --- NQ-3C — Context Notes + narrative reconciliation ---------------------
// Context Notes is the catch-all that re-homes every triggered, non-rollup row the
// three variance sections did not place (e.g. grouped timing/non-cash expense
// lines). Selection only — same toNote() wording. These tests pin the re-home, the
// omit-when-empty rendering, and the NQ-3C invariants (A: each row in exactly one
// prose section; B: those sections are mutually exclusive; C: Review Items may
// overlap). Excel is left unchanged.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { generateNarrative } from '../src/lib/narrative/index.js'
import { triggeredRows } from '../src/lib/narrative/sections.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'
import { narrativeToDocxBlocks } from '../src/lib/export/docx.js'

function rec(o) {
  return {
    account: o.account,
    accountType: o.accountType ?? null,
    category: o.category ?? 'unfavorable',
    comparisonType: 'budget',
    varianceAmount: o.varianceAmount,
    variancePercent: o.variancePercent ?? 50,
    actual: o.actual ?? null,
    budget: o.budget ?? null,
    sourceRows: o.sourceRows,
    thresholdTriggered: o.thresholdTriggered ?? true
  }
}

// 3 large drivers (HV) + grouped timing/non-cash (Context) + one normal expense +
// one revenue line. Depreciation/Prepaid are grouped (below the 3-row headline).
function withContext() {
  return [
    rec({ account: 'Big Driver A', accountType: 'expense', varianceAmount: 30000, sourceRows: [1] }),
    rec({ account: 'Big Driver B', accountType: 'expense', varianceAmount: 25000, sourceRows: [2] }),
    rec({ account: 'Big Driver C', accountType: 'expense', varianceAmount: 20000, sourceRows: [3] }),
    rec({ account: 'Depreciation Expense', accountType: 'expense', varianceAmount: 8000, sourceRows: [4] }), // non_cash
    rec({ account: 'Prepaid Insurance', accountType: 'expense', varianceAmount: 7000, sourceRows: [5] }), // timing
    rec({ account: 'Electric Utilities', accountType: 'expense', varianceAmount: 6000, sourceRows: [6] }), // utilities
    rec({ account: 'Rental Income', accountType: 'revenue', category: 'favorable', varianceAmount: 5000, sourceRows: [7] })
  ]
}

// No row needs re-homing: all place cleanly into HV / Expense / Revenue.
function noContext() {
  return [
    rec({ account: 'Big Driver A', accountType: 'expense', varianceAmount: 30000, sourceRows: [1] }),
    rec({ account: 'Electric Utilities', accountType: 'expense', varianceAmount: 6000, sourceRows: [2] }),
    rec({ account: 'Rental Income', accountType: 'revenue', category: 'favorable', varianceAmount: 5000, sourceRows: [3] })
  ]
}

const accountsOf = (notes) => (notes || []).map((n) => n.account)
const idsOf = (notes) => (notes || []).map((n) => `${n.account}#${n.sourceRows[0]}`)
const period = (rows) => generateNarrative({ comparisons: rows }).periods[0]

// --- 1. Re-home -----------------------------------------------------------
test('NQ-3C: grouped timing/non-cash expense lines re-home into Context Notes', () => {
  const p = period(withContext())
  assert.deepEqual(accountsOf(p.contextNotes), ['Depreciation Expense', 'Prepaid Insurance'])
  // They are NOT in Expense Notes (which keeps only operating themes).
  assert.deepEqual(accountsOf(p.expenseNotes), ['Electric Utilities'])
})

// --- 2. Omit when empty ----------------------------------------------------
test('NQ-3C: Context Notes is omitted (key + render) when nothing needs re-homing', () => {
  const p = period(noContext())
  assert.ok(!('contextNotes' in p), 'no contextNotes key when empty')

  const narrative = generateNarrative({ comparisons: noContext() })
  assert.ok(!/Context Notes/.test(narrativeToMarkdown(narrative)), 'no markdown heading')
  assert.ok(
    !narrativeToDocxBlocks(narrative).some((b) => b.kind === 'section' && b.text === 'Context Notes'),
    'no docx section'
  )
})

// --- 3. Markdown render (after Expense Notes) ------------------------------
test('NQ-3C: Markdown renders Context Notes after Expense Notes with its rows', () => {
  const md = narrativeToMarkdown(generateNarrative({ comparisons: withContext() }))
  assert.ok(/### Context Notes/.test(md), 'heading present')
  assert.ok(md.indexOf('### Context Notes') > md.indexOf('### Expense Notes'), 'after Expense Notes')
  assert.ok(md.includes('Depreciation Expense'), 'row rendered')
})

// --- 4. DOCX render --------------------------------------------------------
test('NQ-3C: DOCX renders a Context Notes section with bullet rows', () => {
  const blocks = narrativeToDocxBlocks(generateNarrative({ comparisons: withContext() }))
  const i = blocks.findIndex((b) => b.kind === 'section' && b.text === 'Context Notes')
  assert.ok(i > -1, 'Context Notes section present')
  assert.equal(blocks[i + 1].kind, 'bullet', 'has bullet rows (not an empty note)')
})

// --- 5. Invariant A — every triggered non-rollup row in exactly one section -
test('NQ-3C invariant A: each triggered non-rollup row appears in exactly one prose section', () => {
  const rows = withContext()
  const p = period(rows)
  const sectionIds = [
    ...idsOf(p.highVariances),
    ...idsOf(p.revenueNotes),
    ...idsOf(p.expenseNotes),
    ...idsOf(p.contextNotes)
  ]
  // No id appears twice across the four sections.
  assert.equal(sectionIds.length, new Set(sectionIds).size, 'no row in two sections')
  // Coverage: exactly the triggered, non-rollup rows are narrated.
  const triggeredIds = triggeredRows(rows).map((c) => `${c.account}#${c.sourceRows[0]}`)
  assert.deepEqual(new Set(sectionIds), new Set(triggeredIds))
  assert.equal(sectionIds.length, triggeredIds.length)
})

// --- 6. Invariant B — sections are mutually exclusive ----------------------
test('NQ-3C invariant B: HV / Revenue / Expense / Context are pairwise disjoint', () => {
  const p = period(withContext())
  const sets = {
    hv: new Set(idsOf(p.highVariances)),
    rev: new Set(idsOf(p.revenueNotes)),
    exp: new Set(idsOf(p.expenseNotes)),
    ctx: new Set(idsOf(p.contextNotes))
  }
  const keys = Object.keys(sets)
  for (let a = 0; a < keys.length; a++) {
    for (let b = a + 1; b < keys.length; b++) {
      for (const id of sets[keys[a]]) {
        assert.ok(!sets[keys[b]].has(id), `${id} in both ${keys[a]} and ${keys[b]}`)
      }
    }
  }
})

// --- 7. Invariant C — Review Items overlap is allowed ----------------------
test('NQ-3C invariant C: Review Items may overlap a primary section (and is inert)', () => {
  // A material, unexplained ("other" theme) driver is WHAT_TO_CHECK and also a
  // High Variance — Review Items is allowed to repeat it.
  const rows = [
    rec({ account: 'Mystery Charge', accountType: 'expense', varianceAmount: 40000, sourceRows: [1] })
  ]
  const p = period(rows)
  assert.ok(accountsOf(p.highVariances).includes('Mystery Charge'))
  assert.ok(accountsOf(p.reviewItems).includes('Mystery Charge'), 'overlap permitted')
  // Inert: Review Items never renders into the owner prose.
  assert.ok(!/Review Items/.test(narrativeToMarkdown(generateNarrative({ comparisons: rows }))))
})

// --- 8. Reconciliation — Executive Summary count matches narrated rows ------
test('NQ-3C: Executive Summary counts exactly the rows that are now narrated', () => {
  const rows = withContext()
  const p = period(rows)
  const narrated = new Set([
    ...idsOf(p.highVariances),
    ...idsOf(p.revenueNotes),
    ...idsOf(p.expenseNotes),
    ...idsOf(p.contextNotes)
  ])
  // buildExecutiveSummary counts triggeredRows — every one is now narrated.
  assert.equal(narrated.size, triggeredRows(rows).length)
})

// --- 9. Excel unchanged — full variance table still lists re-homed rows -----
test('NQ-3C: Excel data source (allVariances) still carries the re-homed rows', () => {
  const p = period(withContext())
  const accts = p.allVariances.map((v) => v.account)
  assert.ok(accts.includes('Depreciation Expense'))
  assert.ok(accts.includes('Prepaid Insurance'))
})
