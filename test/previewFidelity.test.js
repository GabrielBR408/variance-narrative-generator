// Preview fidelity tests — Phase 22.1.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// The live preview must communicate the SAME mental model as Generate:
//   • variance is computed for the BASE report only (supporting files never get
//     a variance table, so they can't read as a variance driver),
//   • the preview flags rows with the user's CURRENT thresholds, and
//   • at the same thresholds the preview rows equal the generated rows.
// These pin that behavior at the pure-logic layer the React components render.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildVariancePreview,
  buildPreviewNarrative,
  previewBasis,
  BASE_TYPE
} from '../src/lib/previewNarrative.js'
import { computeVariance } from '../src/lib/variance/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'
import { DEFAULT_THRESHOLDS } from '../src/lib/variance/thresholds.js'

// --- fixtures --------------------------------------------------------------

// Base report: one strongly flagged line (Utility Expense Recovery 12,700 vs
// 5,334 → +7,366 / 138%) and one quiet line (Office Supplies 120 vs 110).
function baseExtraction(overrides = {}) {
  return {
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
    },
    ...overrides
  }
}

// A Budget supporting file that DOES carry comparable columns — the kind of file
// that used to render its own standalone variance table in the old preview.
function budgetExtraction(overrides = {}) {
  return {
    fileId: 'budget',
    fileName: 'Annual Budget.xlsx',
    status: 'ok',
    confidence: 90,
    classification: { type: 'Budget' },
    normalized: {
      columns: ['Account', 'Actual', 'Budget'],
      rows: [['Insurance', '40000', '10000']],
      accounts: [], dates: [], values: []
    },
    ...overrides
  }
}

function glExtraction(overrides = {}) {
  return {
    fileId: 'gl',
    fileName: 'General Ledger.pdf',
    status: 'ok',
    confidence: 90,
    classification: { type: 'General Ledger (GL)' },
    normalized: {
      columns: ['Account', 'Amount'],
      rows: [['Utility Expense Recovery', '7366']],
      accounts: [], dates: [], values: []
    },
    ...overrides
  }
}

const HIGH_THRESHOLDS = { amount: 100000, percent: 1000 } // nothing triggers

// --- 1. supporting files produce no variance preview -----------------------

test('variance preview computes the base only — supporting files get no variance table', () => {
  const items = [baseExtraction(), budgetExtraction(), glExtraction()]
  const { base, supporting } = buildVariancePreview({ items })

  // Exactly one variance computation, and it is the base report's.
  assert.ok(base, 'base report yields a variance preview')
  assert.equal(base.extraction.fileId, 'base')
  assert.equal(base.variance.fileId, 'base')

  // Both supporting files remain visible but are raw extractions with NO variance.
  assert.deepEqual(supporting.map((ex) => ex.fileId), ['budget', 'gl'])
  for (const ex of supporting) {
    assert.ok(!('variance' in ex), 'supporting file carries no computed variance')
    assert.ok(!Array.isArray(ex.comparisons), 'supporting file is not a variance result')
  }
})

test('a Budget/GL file with no base produces NO base variance preview', () => {
  const { base, supporting } = buildVariancePreview({ items: [budgetExtraction(), glExtraction()] })
  assert.equal(base, null, 'no base report → no variance is computed for any file')
  assert.deepEqual(supporting.map((ex) => ex.fileId), ['budget', 'gl'])
})

// --- 2. preview respects the current thresholds ----------------------------

test('variance preview flags rows with the current thresholds (live, no Generate)', () => {
  const items = [baseExtraction()]

  const def = buildVariancePreview({ items, thresholds: DEFAULT_THRESHOLDS })
  assert.equal(def.base.variance.summary.highVarianceCount, 1, 'flagged at the default threshold')

  const high = buildVariancePreview({ items, thresholds: HIGH_THRESHOLDS })
  assert.equal(high.base.variance.summary.highVarianceCount, 0, 'not flagged once the threshold is raised')

  // The triggered flag on the actual row tracks the threshold too.
  const row = (v) => v.base.variance.comparisons.find((c) => c.account === 'Utility Expense Recovery')
  assert.equal(row(def).thresholdTriggered, true)
  assert.equal(row(high).thresholdTriggered, false)
})

test('preview narrative respects thresholds (rows narrated change with the threshold)', () => {
  const items = [baseExtraction()]
  const def = buildPreviewNarrative({ items, thresholds: DEFAULT_THRESHOLDS })
  const high = buildPreviewNarrative({ items, thresholds: HIGH_THRESHOLDS })
  assert.equal(def.periods[0].highVariances.length, 1)
  assert.equal(high.periods[0].highVariances.length, 0)
})

// --- 3. parity: same thresholds → same rows as Generate --------------------

test('variance preview equals the generate pipeline call on the base', () => {
  const base = baseExtraction()
  for (const thresholds of [DEFAULT_THRESHOLDS, HIGH_THRESHOLDS, { amount: 2000, percent: 25 }]) {
    const preview = buildVariancePreview({ items: [base], thresholds }).base.variance
    const generated = computeVariance(base, thresholds)
    assert.deepEqual(preview, generated, `parity at ${JSON.stringify(thresholds)}`)
    // Row counts match 1:1.
    assert.equal(preview.comparisons.length, generated.comparisons.length)
  }
})

test('preview narrative equals the generate route at the same thresholds', () => {
  const base = baseExtraction()
  const gl = glExtraction()
  const thresholds = { amount: 2000, percent: 25 }
  const expected = enrichNarrative(
    generateNarrative(computeVariance(base, thresholds)),
    { supporting: [gl], mode: 'conservative' }
  )
  const preview = buildPreviewNarrative({ items: [base, gl], thresholds, commentaryMode: 'conservative' })
  assert.deepEqual(preview, expected)
})

// --- 4. causality indicator (preview basis) --------------------------------

test('previewBasis names the base as the only variance driver and counts enrichers', () => {
  const basis = previewBasis({ items: [baseExtraction(), budgetExtraction(), glExtraction()] })
  assert.equal(basis.hasBase, true)
  assert.equal(basis.baseName, 'Comparative Income Statement.xlsx')
  assert.equal(basis.supportingCount, 2)
  assert.deepEqual(basis.supportingNames, ['Annual Budget.xlsx', 'General Ledger.pdf'])
  assert.match(basis.summary, /base report only/i)
  assert.match(basis.summary, /enrich/i)
})

test('previewBasis with no base prompts for one and never claims a driver', () => {
  const basis = previewBasis({ items: [glExtraction()] })
  assert.equal(basis.hasBase, false)
  assert.equal(basis.baseName, null)
  // A GL with no base is not a driver; it is counted as a (would-be) enricher.
  assert.equal(basis.supportingCount, 1)
  assert.match(basis.summary, /add a base report/i)
})

test('previewBasis ignores non-ok extractions', () => {
  const items = [baseExtraction(), glExtraction({ status: 'error' })]
  const basis = previewBasis({ items })
  assert.equal(basis.hasBase, true)
  assert.equal(basis.supportingCount, 0, 'an errored supporting file is not counted')
})
