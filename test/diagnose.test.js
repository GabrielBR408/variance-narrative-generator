// Variance diagnosis layer tests — NQ-5A (metadata only).
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Covers the deterministic diagnosis engine: the closed taxonomy, the approved
// precedence ordering, the advisory confidence scale, the evidenceSources/basis
// provenance, and — critically — the identity invariant: attaching diagnosis is
// metadata only, so rendered output is byte-identical and the no-match /
// no-supporting reference identity still holds.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeVariance } from '../src/lib/variance/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'
import { diagnose, enrichNarrative, DIAGNOSIS_NATURES, EVIDENCE_SOURCES } from '../src/lib/enrich/index.js'

// --- helpers ---------------------------------------------------------------

// One variance note shaped like sections.js → toNote().
function note(over = {}) {
  return {
    account: 'Repairs and Maintenance',
    accountType: 'expense',
    comparisonType: 'budget',
    varianceAmount: 8000,
    variancePercent: 40,
    actual: 28000,
    comparison: 20000,
    ...over
  }
}

// GL-detail summary shaped like match.js → summarizeDetail().
function detail(over = {}) {
  return { count: 4, total: 8000, maxTxn: 2500, vendor: null, description: null, ...over }
}

// --- taxonomy --------------------------------------------------------------

test('taxonomy: every nature emitted is in the closed set (or null)', () => {
  const d = diagnose({ note: note(), detail: detail(), classifyType: 'F', confidence: 1, thick: true, hasCitation: true })
  assert.ok(d.nature === null || DIAGNOSIS_NATURES.includes(d.nature))
  assert.ok(['high', 'medium', 'low'].includes(d.confidence))
  assert.ok(['review', 'monitor', 'none'].includes(d.recommendation))
  assert.ok(Array.isArray(d.basis) && Array.isArray(d.evidenceSources))
  assert.ok(d.evidenceSources.every((s) => EVIDENCE_SOURCES.includes(s)))
})

test('taxonomy: account families map to structural natures', () => {
  assert.equal(diagnose({ note: note({ account: 'Depreciation Expense' }) }).nature, 'NON_CASH')
  assert.equal(diagnose({ note: note({ account: 'Prepaid Insurance' }) }).nature, 'BALANCE_SHEET')
  assert.equal(diagnose({ note: note({ account: 'Utility Expense Recovery' }) }).nature, 'MAPPING_PASSTHROUGH')
})

test('taxonomy: GL-shape natures', () => {
  // Aligned, quantified real spend.
  assert.equal(
    diagnose({ note: note(), detail: detail(), classifyType: 'A', contribution: { contributionType: 'aligned' }, confidence: 1, thick: true, hasCitation: true }).nature,
    'REAL_SPEND'
  )
  // Recurring population.
  assert.equal(
    diagnose({ note: note(), detail: detail({ count: 6 }), classifyType: 'C', confidence: 1, thick: true, hasCitation: true }).nature,
    'RECURRING_RATE'
  )
})

test('taxonomy: TIMING_PHASING when budgeted but nothing posted', () => {
  const d = diagnose({ note: note({ actual: 0, comparison: 18000, varianceAmount: -18000, variancePercent: -100 }), hasCitation: false })
  assert.equal(d.nature, 'TIMING_PHASING')
  assert.equal(d.qualifiers.structural, true)
})

test('taxonomy: null when operationally immaterial and no account family', () => {
  const d = diagnose({ note: note({ varianceAmount: 50, variancePercent: 5, actual: 950, comparison: 900 }), hasCitation: true })
  assert.equal(d.nature, null)
  assert.deepEqual(d.basis, ['immaterial'])
  assert.equal(d.recommendation, 'none')
})

// --- precedence ------------------------------------------------------------

test('precedence: RECOVERY account beats UNBUDGETED (recovery is never an overage)', () => {
  // Zero budget + real activity would otherwise read as UNBUDGETED; the recovery
  // account family (rule 3) wins first.
  const d = diagnose({
    note: note({ account: 'CAM Recovery', comparison: 0, varianceAmount: 15000, variancePercent: 100 }),
    detail: detail({ total: 15000 }),
    classifyType: 'D',
    confidence: 1,
    thick: true,
    hasCitation: true
  })
  assert.equal(d.nature, 'MAPPING_PASSTHROUGH')
})

test('precedence: credit / true-up beats UNBUDGETED-with-activity', () => {
  // Unbudgeted (comparison 0) AND a net credit total; the credit rule (5) precedes
  // the unbudgeted rule (6).
  const d = diagnose({
    note: note({ comparison: 0, actual: 4000, varianceAmount: 4000, variancePercent: 100 }),
    detail: detail({ total: -9000, count: 1 }),
    classifyType: 'E',
    confidence: 1,
    thick: true,
    hasCitation: true
  })
  assert.equal(d.nature, 'ACCRUAL_TRUEUP')
  assert.equal(d.qualifiers.credit, true)
})

test('precedence: direction-conflict → ACCRUAL_TRUEUP', () => {
  const d = diagnose({
    note: note(),
    detail: detail(),
    classifyType: 'DC',
    contribution: { contributionType: 'direction-conflict' },
    confidence: 1,
    thick: true,
    hasCitation: true
  })
  assert.equal(d.nature, 'ACCRUAL_TRUEUP')
})

test('precedence: UNBUDGETED with activity (no credit, no recovery name)', () => {
  const d = diagnose({
    note: note({ comparison: 0, varianceAmount: 12000, variancePercent: 100 }),
    detail: detail({ total: 12000 }),
    classifyType: 'D',
    confidence: 1,
    thick: true,
    hasCitation: true
  })
  assert.equal(d.nature, 'UNBUDGETED')
})

test('precedence: material but unsupported → INDETERMINATE', () => {
  const d = diagnose({ note: note({ varianceAmount: 20000, variancePercent: 80 }), thick: false, hasCitation: true })
  assert.equal(d.nature, 'INDETERMINATE')
  assert.equal(d.recommendation, 'review')
})

// --- confidence ------------------------------------------------------------

test('confidence: account-name structural is high; INDETERMINATE is low', () => {
  assert.equal(diagnose({ note: note({ account: 'Depreciation Expense' }) }).confidence, 'high')
  assert.equal(diagnose({ note: note({ varianceAmount: 20000 }), thick: false, hasCitation: true }).confidence, 'low')
})

test('confidence: GL-shape natures scale with match quality', () => {
  const strong = diagnose({ note: note(), detail: detail(), classifyType: 'A', contribution: { contributionType: 'aligned' }, confidence: 1, thick: true, hasCitation: true })
  const moderate = diagnose({ note: note(), detail: detail(), classifyType: 'A', contribution: { contributionType: 'aligned' }, confidence: 0.75, thick: true, hasCitation: true })
  assert.equal(strong.confidence, 'high')
  assert.equal(moderate.confidence, 'medium')
})

// --- evidenceSources / basis ----------------------------------------------

test('evidenceSources: provenance reflects the signals actually used', () => {
  const mapping = diagnose({ note: note({ account: 'Utility Expense Recovery' }) })
  assert.deepEqual(mapping.evidenceSources, ['ACCOUNT_NAME'])
  assert.deepEqual(mapping.basis, ['accountSemantics:RECOVERY'])

  const credit = diagnose({ note: note(), detail: detail({ total: -9000, count: 1 }), classifyType: 'E', confidence: 1, thick: true, hasCitation: true })
  assert.ok(credit.evidenceSources.includes('VARIANCE_SIGN'))
  assert.ok(credit.evidenceSources.includes('GL_DETAIL'))

  const real = diagnose({ note: note(), detail: detail(), classifyType: 'B', contribution: { contributionType: 'aligned' }, confidence: 1, thick: true, hasCitation: true })
  assert.ok(real.evidenceSources.includes('GL_DETAIL'))
  assert.ok(real.evidenceSources.includes('CONTRIBUTION'))
  assert.ok(real.evidenceSources.includes('CLASSIFIER'))
})

test('purity: diagnose returns a fresh object and mutates nothing', () => {
  const n = note()
  const frozen = JSON.stringify(n)
  diagnose({ note: n, detail: detail(), classifyType: 'A', confidence: 1, thick: true, hasCitation: true })
  assert.equal(JSON.stringify(n), frozen, 'the input note is untouched')
})

// --- integration + identity (render unchanged) -----------------------------

function rec({ account, actual, budget, accountType, category, sourceRows }) {
  const varianceAmount = actual - budget
  const variancePercent = budget === 0 ? null : (varianceAmount / Math.abs(budget)) * 100
  const thresholdTriggered = Math.abs(varianceAmount) >= 1000 || (variancePercent !== null && Math.abs(variancePercent) >= 10)
  return {
    account, actual, budget, prior: null, varianceAmount, variancePercent,
    comparisonType: 'budget', thresholdTriggered, category, accountType,
    missingData: false, confidence: 90, sourceRows: sourceRows || []
  }
}

function baseNarrative(comparisons) {
  return generateNarrative({
    fileId: 'base', fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report', thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{ period: 'current', comparisons }]
  })
}

const GL = (fileName = 'General Ledger.pdf') => ({
  fileName, status: 'ok', classification: { type: 'General Ledger (GL)' },
  normalized: { columns: ['Account', 'Amount'], rows: [['5100 Utility Expense Recovery', '7366'], ['6000 Office Supplies', '120']] }
})

const FLAGGED = [rec({ account: 'Utility Expense Recovery', actual: 12700, budget: 5334, accountType: 'expense', category: 'unfavorable', sourceRows: [4] })]

function stripDiagnosis(narr) {
  const clean = (notes) => (Array.isArray(notes) ? notes.map(({ diagnosis, ...rest }) => rest) : notes)
  return {
    ...narr,
    periods: narr.periods.map((p) => ({
      ...p, highVariances: clean(p.highVariances), revenueNotes: clean(p.revenueNotes), expenseNotes: clean(p.expenseNotes)
    }))
  }
}

test('integration: a matched note carries a diagnosis', () => {
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [GL()] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  assert.ok(note.diagnosis, 'diagnosis attached to the enriched note')
  // "Utility Expense Recovery" is a recovery account → MAPPING_PASSTHROUGH.
  assert.equal(note.diagnosis.nature, 'MAPPING_PASSTHROUGH')
})

test('identity: diagnosis does not lower existing match confidence', () => {
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [GL()] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  assert.equal(note.support[0].confidence, 0.9, 'the GL name-match confidence is untouched')
})

test('identity: wording is byte-identical and render ignores diagnosis', () => {
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [GL()] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  // The exact pre-NQ-5A sentence is preserved (diagnosis changed no wording).
  assert.match(
    note.text,
    /^Utility Expense Recovery exceeded budget by \$7,366 \(138\.1%\)\. The movement reflects a single transaction of approximately \$7,400\.$/
  )
  // Markdown is identical with or without the diagnosis metadata present.
  assert.equal(narrativeToMarkdown(enriched), narrativeToMarkdown(stripDiagnosis(enriched)))
})

test('identity: no-supporting and no-match still return the same reference', () => {
  const n = baseNarrative(FLAGGED)
  assert.equal(enrichNarrative(n, { supporting: [] }), n)
  const noMatch = GL()
  noMatch.normalized.rows = [['9999 Landscaping', '50'], ['8888 Parking', '75']]
  assert.equal(enrichNarrative(n, { supporting: [noMatch] }), n)
})
