// --- NQ-3B — Sections consume the commentary plan -------------------------
// Sections are now SELECTED from period.plan (disposition / materiality / theme /
// ownerQuestion). Sentence generation is unchanged. These tests pin the new
// selection rules and prove the new Review Items section is additive (it never
// leaks into the existing exports).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { generateNarrative } from '../src/lib/narrative/index.js'
import { buildCommentaryPlan } from '../src/lib/plan/commentaryPlan.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'
import { buildPreviewNarrative, BASE_TYPE } from '../src/lib/previewNarrative.js'
import { computeVariance } from '../src/lib/variance/index.js'
import { DEFAULT_THRESHOLDS } from '../src/lib/variance/thresholds.js'

// A triggered comparison row (figures already computed by the variance engine).
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

// Headline drivers (A/B/C) are the three largest; D–H are grouped category lines
// spanning every theme path the selection rules care about.
function mixed() {
  return [
    rec({ account: 'Miscellaneous Expense', accountType: 'expense', varianceAmount: 20000, sourceRows: [1] }),
    rec({ account: 'Management Fees', accountType: 'expense', varianceAmount: 18000, sourceRows: [2] }),
    rec({ account: 'Professional Services', accountType: 'expense', varianceAmount: 15000, sourceRows: [3] }),
    rec({ account: 'Depreciation Expense', accountType: 'expense', varianceAmount: 6000, sourceRows: [4] }), // non_cash
    rec({ account: 'Prepaid Insurance', accountType: 'expense', varianceAmount: 5000, sourceRows: [5] }), // timing
    rec({ account: 'Electric Utilities', accountType: 'expense', varianceAmount: 4000, sourceRows: [6] }), // utilities
    rec({ account: 'Rental Income', accountType: 'revenue', category: 'favorable', varianceAmount: 3500, sourceRows: [7] }),
    rec({ account: 'Parking Income', accountType: 'revenue', category: 'favorable', varianceAmount: 2500, sourceRows: [8] })
  ]
}

const accountsOf = (notes) => (notes || []).map((n) => n.account)

function period(rows) {
  return generateNarrative({ comparisons: rows }).periods[0]
}

// --- 1. Sections consume the plan ------------------------------------------
test('NQ-3B: High Variances membership is exactly the plan individual/top-or-material set', () => {
  const rows = mixed()
  const p = period(rows)
  const plan = buildCommentaryPlan(rows)

  // Every High Variance note maps to an individual, top_driver|material plan item.
  for (const note of p.highVariances) {
    const id = `${note.account}#${note.sourceRows[0]}`
    const item = plan.items.find((i) => i.id === id)
    assert.ok(item, `plan item for ${note.account}`)
    assert.equal(item.disposition, 'individual')
    assert.ok(['top_driver', 'material'].includes(item.materiality))
  }
  // And the converse: each such plan item is present in High Variances.
  const hvIds = new Set(p.highVariances.map((n) => `${n.account}#${n.sourceRows[0]}`))
  for (const i of plan.items) {
    if (i.disposition === 'individual' && ['top_driver', 'material'].includes(i.materiality)) {
      assert.ok(hvIds.has(i.id), `${i.id} should be in High Variances`)
    }
  }
})

// --- 2. Review Items renders -----------------------------------------------
test('NQ-3B: Review Items renders for WHAT_TO_CHECK rows, after Expense Notes', () => {
  const p = period(mixed())
  assert.ok(Array.isArray(p.reviewItems) && p.reviewItems.length > 0, 'reviewItems present')
  // Material unexplained drivers are flagged; semantic lines (utilities/timing/
  // non-cash) are not.
  assert.ok(accountsOf(p.reviewItems).includes('Miscellaneous Expense'))
  assert.ok(!accountsOf(p.reviewItems).includes('Electric Utilities')) // WHY
  assert.ok(!accountsOf(p.reviewItems).includes('Prepaid Insurance')) // DOES_IT_MATTER
  assert.ok(!accountsOf(p.reviewItems).includes('Depreciation Expense')) // WHAT_HAPPENED

  // Key order: reviewItems sits after expenseNotes.
  const keys = Object.keys(p)
  assert.ok(keys.indexOf('reviewItems') > keys.indexOf('expenseNotes'), 'reviewItems after expenseNotes')
})

// --- 3. Review Items omitted when empty ------------------------------------
test('NQ-3B: Review Items is omitted entirely when nothing needs review', () => {
  // Only utilities (WHY) and timing (DOES_IT_MATTER) — no WHAT_TO_CHECK row.
  const rows = [
    rec({ account: 'Electric Utilities', accountType: 'expense', varianceAmount: 5000, sourceRows: [1] }),
    rec({ account: 'Prepaid Insurance', accountType: 'expense', varianceAmount: 4000, sourceRows: [2] })
  ]
  const p = period(rows)
  assert.ok(!('reviewItems' in p), 'reviewItems key omitted when empty')
})

// --- 4. Revenue isolation --------------------------------------------------
test('NQ-3B: Revenue Notes hold only grouped revenue/leasing lines', () => {
  const p = period(mixed())
  assert.deepEqual(accountsOf(p.revenueNotes), ['Rental Income', 'Parking Income'])
  // No expense line ever appears in Revenue Notes.
  for (const n of p.revenueNotes) assert.equal(n.accountType, 'revenue')
})

// --- 5. Expense exclusion --------------------------------------------------
test('NQ-3B: Expense Notes exclude timing/balance-sheet and non-cash themes', () => {
  const p = period(mixed())
  const accts = accountsOf(p.expenseNotes)
  assert.ok(accts.includes('Electric Utilities'), 'utilities expense kept')
  assert.ok(!accts.includes('Depreciation Expense'), 'non-cash excluded')
  assert.ok(!accts.includes('Prepaid Insurance'), 'timing/balance-sheet excluded')
})

// --- 6. Output stability ---------------------------------------------------
test('NQ-3B: selection is deterministic and order-independent', () => {
  const rows = mixed()
  const a = generateNarrative({ comparisons: rows })
  const b = generateNarrative({ comparisons: rows })
  assert.deepEqual(a, b)
  // Reversing the input changes no section membership.
  const r = period([...rows].reverse())
  const f = period(rows)
  assert.deepEqual(accountsOf(r.highVariances), accountsOf(f.highVariances))
  assert.deepEqual(accountsOf(r.expenseNotes), accountsOf(f.expenseNotes))
  assert.deepEqual(accountsOf(r.revenueNotes), accountsOf(f.revenueNotes))
  assert.deepEqual(accountsOf(r.reviewItems), accountsOf(f.reviewItems))
})

// --- 7. Preview parity -----------------------------------------------------
test('NQ-3B: preview route matches the generate route section-for-section', () => {
  const base = {
    fileId: 'base',
    fileName: 'Comparative Income Statement.xlsx',
    status: 'ok',
    confidence: 90,
    classification: { type: BASE_TYPE },
    normalized: {
      columns: ['Account', 'Actual', 'Budget'],
      rows: [
        ['Utility Expense Recovery', '12700', '5334'],
        ['Office Supplies', '120', '110']
      ],
      accounts: [], dates: [], values: []
    }
  }
  const preview = buildPreviewNarrative({ items: [base], thresholds: DEFAULT_THRESHOLDS })
  const expected = generateNarrative(computeVariance(base, DEFAULT_THRESHOLDS))
  assert.deepEqual(preview, expected)
})

// --- 8. Exports unchanged (Review Items never leaks into Markdown) ----------
test('NQ-3B: Markdown export ignores Review Items (byte-identical with it stripped)', () => {
  const narrative = generateNarrative({ comparisons: mixed() })
  assert.ok(narrative.periods[0].reviewItems, 'fixture does carry reviewItems')

  const withReview = narrativeToMarkdown(narrative)
  const stripped = {
    ...narrative,
    periods: narrative.periods.map(({ reviewItems, ...rest }) => rest) // eslint-disable-line no-unused-vars
  }
  const withoutReview = narrativeToMarkdown(stripped)

  assert.equal(withReview, withoutReview)
  assert.ok(!/Review Items/i.test(withReview), 'no Review Items heading in export')
})
