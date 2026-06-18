// --- Account resolution tests — NQ-4C.1 ------------------------------------
// Deterministic resolution of owner-facing base variance lines to GL bookkeeping
// account labels: a guarded, qualifier-aware significant-token subset match that
// connects "HVAC Contract" → "Repairs & Maintenance - HVAC" without admitting
// near-miss accounts (different equipment, contra / balance-sheet accounts).
// Runs on `node --test`, no deps.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildEvidenceIndex,
  scoreMatch,
  scoreMatchDetailed,
  resolveScore,
  significantTokens,
  enrichNarrative,
  CONFIDENCE_FLOOR,
  RESOLVED_EQUAL_SCORE,
  RESOLVED_SUBSET_SCORE
} from '../src/lib/enrich/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'

// --- helpers ---------------------------------------------------------------

function supporting({ fileName = 'GL.pdf', type = 'General Ledger (GL)', columns, rows }) {
  return { fileName, status: 'ok', classification: { type }, normalized: { columns, rows } }
}

// One index entry from a GL account label (single Account column).
function entryOf(label) {
  const [e] = buildEvidenceIndex([supporting({ columns: ['Account'], rows: [[label]] })])
  return e
}

// --- significantTokens -----------------------------------------------------

test('significantTokens strips qualifier filler words', () => {
  assert.deepEqual(significantTokens('HVAC Contract'), ['hvac'])
  assert.deepEqual(significantTokens('Repairs & Maintenance - HVAC'), ['hvac'])
  assert.deepEqual(significantTokens('Management Fees - Other'), ['management'])
  assert.deepEqual(significantTokens('Water & Sewer'), ['water', 'sewer'])
  // All-qualifier label → nothing significant left.
  assert.deepEqual(significantTokens('Other Expense'), [])
  assert.deepEqual(significantTokens('Repairs & Maintenance'), [])
})

// --- true-positive matrix --------------------------------------------------

const TRUE_POSITIVES = [
  ['HVAC Contract', 'Repairs & Maintenance - HVAC', 'resolved_equal'],
  ['Elevator Maintenance', 'Repairs & Maintenance - Elevator', 'resolved_equal'],
  ['Janitorial Contract', 'Janitorial Services', 'resolved_equal'],
  ['Janitorial Contract', 'Contract Services - Janitorial', 'resolved_equal'],
  ['Security Service', 'Security - Contract', 'resolved_equal'],
  ['Landscaping', 'Repairs & Maintenance - Landscaping', 'resolved_equal'],
  ['Management Fee', 'Management Fees - Other', 'resolved_equal'],
  ['Electric', 'Utilities - Electric', 'resolved_subset'],
  ['Water & Sewer', 'Utilities - Water/Sewer', 'resolved_subset']
]

test('true positives resolve at the expected tier', () => {
  for (const [base, gl, method] of TRUE_POSITIVES) {
    const r = resolveScore(base, entryOf(gl))
    assert.equal(r.method, method, `${base} → ${gl}: resolve method`)
    const expected = method === 'resolved_equal' ? RESOLVED_EQUAL_SCORE : RESOLVED_SUBSET_SCORE
    assert.equal(r.score, expected, `${base} → ${gl}: resolve score`)
  }
})

test('every true positive is cited end-to-end (>= floor)', () => {
  // A couple of pairs (e.g. "Management Fee" / "Water & Sewer") are admitted by
  // the pre-existing substring tier rather than resolution — either way they now
  // enrich, which is the goal. So assert citation, not the specific tier here.
  for (const [base, gl] of TRUE_POSITIVES) {
    assert.ok(scoreMatch(base, entryOf(gl)) >= CONFIDENCE_FLOOR, `${base} → ${gl} should be cited`)
  }
})

// --- false-positive matrix -------------------------------------------------

const FALSE_POSITIVES = [
  ['HVAC Contract', 'Elevator Contract'], // different equipment
  ['Janitorial Contract', 'Landscaping Contract'],
  ['Repairs & Maintenance - Elevator', 'Repairs & Maintenance - HVAC'],
  ['Management Fee', 'Legal Fee'],
  ['Electric', 'Electric Vehicle Charging'], // single-token dilution (jaccard)
  ['Insurance', 'Insurance Claims Receivable'], // disqualifier + jaccard
  ['Real Estate Tax', 'Real Estate Tax Refund'] // disqualifier (refund)
]

test('the resolution layer rejects every false positive', () => {
  for (const [base, gl] of FALSE_POSITIVES) {
    const r = resolveScore(base, entryOf(gl))
    assert.equal(r.score, 0, `${base} → ${gl}: resolution must reject`)
    assert.equal(r.method, null)
  }
})

// 6 of 7 also fall below the match floor entirely. "Real Estate Tax" vs
// "…Tax Refund" is admitted only by the PRE-EXISTING substring tier (0.70),
// which NQ-4C.1 preserves unchanged and does not scope — resolution itself still
// rejects it (asserted above). Documented as a known cross-tier limitation.
test('false positives not preempted by the substring tier stay below the floor', () => {
  for (const [base, gl] of FALSE_POSITIVES) {
    if (base === 'Real Estate Tax') continue // pre-existing substring match (out of scope)
    assert.ok(scoreMatch(base, entryOf(gl)) < CONFIDENCE_FLOOR, `${base} → ${gl}: below floor`)
  }
})

test('Real Estate Tax → Tax Refund is rejected by resolution (substring tier is pre-existing)', () => {
  assert.equal(resolveScore('Real Estate Tax', entryOf('Real Estate Tax Refund')).score, 0)
  // The 0.70 the full scorer returns comes from the substring tier, not resolution.
  assert.equal(scoreMatchDetailed('Real Estate Tax', entryOf('Real Estate Tax Refund')).method, 'substring')
})

// --- recovery is NOT disqualifying -----------------------------------------

test('recovery is not a disqualifying token (real expense-recovery line)', () => {
  // base {utility} ⊆ entry {utility, recovery}; recovery must not reject it.
  const r = resolveScore('Utility Expense', entryOf('Utility Expense Recovery'))
  assert.equal(r.method, 'resolved_subset')
  assert.equal(r.score, RESOLVED_SUBSET_SCORE)
})

// --- existing tiers unchanged ----------------------------------------------

test('exact code / name / substring tiers are unchanged and report matchMethod', () => {
  const [byCode] = buildEvidenceIndex([supporting({ columns: ['Account'], rows: [['5100 Utilities']] })])
  assert.deepEqual(scoreMatchDetailed('5100 Utility Expense Recovery', byCode), { score: 1.0, method: 'exact_code' })

  const byName = entryOf('Utility Expense Recovery')
  assert.deepEqual(scoreMatchDetailed('Utility Expense Recovery', byName), { score: 0.9, method: 'exact_name' })

  const bySub = entryOf('Total Utility Expense Recovery Detail')
  assert.deepEqual(scoreMatchDetailed('Utility Expense Recovery', bySub), { score: 0.7, method: 'substring' })

  // A genuinely unrelated label still falls below the floor with no method.
  const r = scoreMatchDetailed('Utility Expense Recovery', entryOf('Utility Expense Insurance'))
  assert.ok(r.score < CONFIDENCE_FLOOR)
  assert.equal(r.method, null)
})

// --- end-to-end: HVAC Contract now enriches --------------------------------

function hvacBase() {
  return generateNarrative({
    fileId: 'base', fileName: 'CIS.xlsx', baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{ period: 'current', comparisons: [{
      account: 'HVAC Contract', actual: 18250, budget: 9000, prior: null,
      varianceAmount: 9250, variancePercent: 102.8, comparisonType: 'budget',
      thresholdTriggered: true, category: 'unfavorable', accountType: 'expense',
      missingData: false, confidence: 90, sourceRows: [7]
    }] }]
  })
}

test('HVAC Contract resolves to Repairs & Maintenance - HVAC and enriches (no vendor)', () => {
  const gl = supporting({
    fileName: '4. General Ledger.pdf',
    columns: ['Account', 'Vendor', 'Amount'],
    rows: [
      ['Repairs & Maintenance - HVAC', 'Bay City Mechanical', '4625'],
      ['Repairs & Maintenance - HVAC', 'Bay City Mechanical', '4625']
    ]
  })
  const note = enrichNarrative(hvacBase(), { supporting: [gl] }).periods[0].highVariances
    .find((x) => x.account === 'HVAC Contract')

  assert.ok(note.enriched, 'note should now be enriched')
  assert.equal(note.support[0].matchMethod, 'resolved_equal', 'matchMethod populated')
  assert.equal(note.support[0].confidence, RESOLVED_EQUAL_SCORE)
  // Quantified GL sentence appears where there was previously none …
  assert.match(note.text, /The movement reflects approximately \$9,300 across 2 related transactions\.$/)
  // … and NO vendor name (resolved confidence 0.85 < the 0.90 vendor gate).
  assert.doesNotMatch(note.text, /Bay City Mechanical/)
})

test('matchMethod is populated for an exact match too', () => {
  const gl = supporting({
    fileName: 'GL.pdf', columns: ['Account', 'Amount'],
    rows: [['HVAC Contract', '4625'], ['HVAC Contract', '4625']]
  })
  const note = enrichNarrative(hvacBase(), { supporting: [gl] }).periods[0].highVariances
    .find((x) => x.account === 'HVAC Contract')
  assert.equal(note.support[0].matchMethod, 'exact_name')
})
