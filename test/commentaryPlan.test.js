// --- NQ-3A — Commentary Planning Layer tests -------------------------------
// Proves the plan is built deterministically AND is fully inert: it attaches to
// every period but changes no owner-visible output (sections, markdown, preview,
// conservative enrichment all stay byte-identical).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildCommentaryPlan, themeOf } from '../src/lib/plan/commentaryPlan.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import {
  buildHighVariances,
  buildRevenueNotes,
  buildExpenseNotes
} from '../src/lib/narrative/sections.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'

// A varied comparison set covering every disposition / materiality / theme path.
// Figures are already-computed variance records — the plan only READS them.
function comparisons() {
  return [
    // utilities, triggered, deferred to a category note → grouped / material
    { account: 'Electric Utilities', accountType: 'expense', category: 'unfavorable',
      comparisonType: 'budget', varianceAmount: 5000, variancePercent: 40,
      actual: 17000, budget: 12000, sourceRows: [2], thresholdTriggered: true },
    // janitorial, triggered, deferred → grouped / material
    { account: 'Janitorial Service', accountType: 'expense', category: 'unfavorable',
      comparisonType: 'budget', varianceAmount: 3000, variancePercent: 20,
      actual: 8000, budget: 5000, sourceRows: [3], thresholdTriggered: true },
    // timing / balance-sheet (Prepaid), triggered, headline → individual / top_driver
    { account: 'Prepaid Insurance', accountType: 'expense', category: 'unfavorable',
      comparisonType: 'budget', varianceAmount: 8000, variancePercent: 30,
      actual: 18000, budget: 10000, sourceRows: [4], thresholdTriggered: true },
    // large unexplained "other", triggered, headline → individual / top_driver
    { account: 'Miscellaneous Expense', accountType: 'expense', category: 'unfavorable',
      comparisonType: 'budget', varianceAmount: 20000, variancePercent: 50,
      actual: 60000, budget: 40000, sourceRows: [5], thresholdTriggered: true },
    // sub-$1 zero-noise (crossed only on percent) → suppressed / noise
    { account: 'Bank Charges', accountType: 'expense', category: 'unfavorable',
      comparisonType: 'budget', varianceAmount: 0.5, variancePercent: 300,
      actual: 0.67, budget: 0.17, sourceRows: [6], thresholdTriggered: true },
    // below threshold → suppressed / immaterial
    { account: 'Office Supplies', accountType: 'expense', category: 'unfavorable',
      comparisonType: 'budget', varianceAmount: 50, variancePercent: 10,
      actual: 550, budget: 500, sourceRows: [7], thresholdTriggered: false },
    // statement rollup → rollup (never narrated)
    { account: 'TOTAL EXPENSES', accountType: 'expense', category: 'unfavorable',
      comparisonType: 'budget', varianceAmount: 40000, variancePercent: 35,
      actual: 150000, budget: 110000, sourceRows: [8], thresholdTriggered: true },
    // revenue, triggered, headline → individual / top_driver
    { account: 'Rental Income', accountType: 'revenue', category: 'favorable',
      comparisonType: 'budget', varianceAmount: 9000, variancePercent: 15,
      actual: 69000, budget: 60000, sourceRows: [9], thresholdTriggered: true }
  ]
}

function itemById(plan, id) {
  return plan.items.find((i) => i.id === id)
}

// --- 1. Plan attaches ------------------------------------------------------
test('NQ-3A: plan attaches to every generated period', () => {
  const narrative = generateNarrative({ comparisons: comparisons() })
  const period = narrative.periods[0]
  assert.ok(period.plan, 'period carries a plan')
  assert.ok(period.plan.meta && period.plan.meta.counts, 'plan has meta.counts')
  assert.ok(Array.isArray(period.plan.items), 'plan has items array')
  assert.deepEqual(period.plan.groups, [], 'groups empty in NQ-3A')
})

// --- 2. Output unchanged (markdown ignores the plan) -----------------------
test('NQ-3A: markdown export is byte-identical with or without the plan', () => {
  const narrative = generateNarrative({ comparisons: comparisons() })
  const withPlan = narrativeToMarkdown(narrative)

  // Strip the plan and re-render — must be identical (plan is never rendered).
  const stripped = {
    ...narrative,
    periods: narrative.periods.map(({ plan, ...rest }) => rest) // eslint-disable-line no-unused-vars
  }
  const withoutPlan = narrativeToMarkdown(stripped)

  assert.equal(withPlan, withoutPlan)
  assert.ok(!/WHAT_TO_CHECK|DOES_IT_MATTER|top_driver|disposition/.test(withPlan),
    'no planning tokens leak into owner-visible markdown')
})

// --- 3. No section changes -------------------------------------------------
test('NQ-3A: the five sections match the renderer exactly (plan does not alter them)', () => {
  const rows = comparisons()
  const period = generateNarrative({ comparisons: rows }).periods[0]
  assert.deepEqual(period.highVariances, buildHighVariances(rows))
  assert.deepEqual(period.revenueNotes, buildRevenueNotes(rows))
  assert.deepEqual(period.expenseNotes, buildExpenseNotes(rows))
})

// --- 4. Theme assignment ---------------------------------------------------
test('NQ-3A: themeOf maps each business family deterministically', () => {
  assert.equal(themeOf('Electric Utilities'), 'utilities')
  assert.equal(themeOf('Security Monitoring'), 'security')
  assert.equal(themeOf('Janitorial Service'), 'janitorial')
  assert.equal(themeOf('Repairs & Maintenance'), 'repairs')
  assert.equal(themeOf('Rental Income'), 'revenue_leasing')
  assert.equal(themeOf('Real Estate Taxes'), 'taxes')
  // Account-semantic families win first.
  assert.equal(themeOf('Depreciation Expense'), 'non_cash')
  assert.equal(themeOf('Utility Expense Recovery'), 'recoveries')
  assert.equal(themeOf('Prepaid Insurance'), 'timing_balance_sheet')
  // Fallbacks.
  assert.equal(themeOf('Management Fee'), 'other')
  assert.equal(themeOf('Unlabeled Line', 'revenue'), 'revenue_leasing')
})

// --- 5. OwnerQuestion assignment -------------------------------------------
test('NQ-3A: ownerQuestion follows the planning rules', () => {
  const plan = buildCommentaryPlan(comparisons())
  assert.equal(itemById(plan, 'Prepaid Insurance#4').ownerQuestion, 'DOES_IT_MATTER') // timing
  assert.equal(itemById(plan, 'Electric Utilities#2').ownerQuestion, 'WHY')            // utilities
  assert.equal(itemById(plan, 'Janitorial Service#3').ownerQuestion, 'WHY')            // recurring operating
  assert.equal(itemById(plan, 'Miscellaneous Expense#5').ownerQuestion, 'WHAT_TO_CHECK') // large unexplained
  assert.equal(itemById(plan, 'Office Supplies#7').ownerQuestion, 'WHAT_HAPPENED')     // fallback
})

// --- 6. Materiality assignment ---------------------------------------------
test('NQ-3A: materiality bands reuse the renderer thresholds', () => {
  const plan = buildCommentaryPlan(comparisons())
  assert.equal(itemById(plan, 'Bank Charges#6').materiality, 'noise')        // sub-$1
  assert.equal(itemById(plan, 'Office Supplies#7').materiality, 'immaterial') // below threshold, small
  assert.equal(itemById(plan, 'Miscellaneous Expense#5').materiality, 'top_driver')
  assert.equal(itemById(plan, 'Electric Utilities#2').materiality, 'material')
})

// --- 7. Partition invariant ------------------------------------------------
test('NQ-3A: every row is represented exactly once across the four dispositions', () => {
  const rows = comparisons()
  const plan = buildCommentaryPlan(rows)
  assert.equal(plan.items.length, rows.length)
  const { individual, grouped, suppressed, rollup } = plan.meta.counts
  assert.equal(individual + grouped + suppressed + rollup, rows.length)
  // Counts equal the actual per-disposition tallies.
  const tally = { individual: 0, grouped: 0, suppressed: 0, rollup: 0 }
  for (const i of plan.items) {
    assert.ok(i.disposition in tally, `valid disposition: ${i.disposition}`)
    tally[i.disposition] += 1
  }
  assert.deepEqual(tally, plan.meta.counts)
  // Expected partition for this fixture.
  assert.deepEqual(plan.meta.counts, { individual: 3, grouped: 2, suppressed: 2, rollup: 1 })
})

// --- 8. Deterministic ordering ---------------------------------------------
test('NQ-3A: ordering is deterministic and independent of input order', () => {
  const rows = comparisons()
  const a = buildCommentaryPlan(rows)
  const b = buildCommentaryPlan([...rows].reverse())
  assert.deepEqual(a.items.map((i) => i.id), b.items.map((i) => i.id))
  // Same input → deep-equal plan (pure function).
  assert.deepEqual(buildCommentaryPlan(rows), a)
  // Order is by materiality (largest absolute movement first).
  assert.deepEqual(a.items.map((i) => i.id), [
    'TOTAL EXPENSES#8',
    'Miscellaneous Expense#5',
    'Rental Income#9',
    'Prepaid Insurance#4',
    'Electric Utilities#2',
    'Janitorial Service#3',
    'Office Supplies#7',
    'Bank Charges#6'
  ])
})

// --- 9. Preview parity unchanged -------------------------------------------
test('NQ-3A: identical comparisons yield identical plans (preview == generate route)', () => {
  const rows = comparisons()
  // The preview and generate routes both build the narrative from the SAME
  // comparisons, so an identical, pure plan guarantees parity between them.
  const viaGenerateA = generateNarrative({ comparisons: rows }).periods[0].plan
  const viaGenerateB = generateNarrative({ comparisons: rows }).periods[0].plan
  assert.deepEqual(viaGenerateA, viaGenerateB)
})

// --- 10. Conservative mode unchanged ---------------------------------------
test('NQ-3A: conservative enrichment leaves the plan and output untouched', () => {
  const narrative = generateNarrative({ comparisons: comparisons() })
  // No supporting files → enrichment is identity; the plan rides through intact.
  const enriched = enrichNarrative(narrative, { supporting: [], mode: 'conservative' })
  assert.equal(enriched, narrative, 'identity invariant preserved')
  assert.deepEqual(enriched.periods[0].plan, narrative.periods[0].plan)
})
