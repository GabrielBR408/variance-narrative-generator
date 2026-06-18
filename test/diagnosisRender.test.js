// Diagnosis consumption tests — NQ-5B (refined).
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// NQ-5B renders the diagnosis metadata as owner-facing wording for four natures
// (OFFSET_TIMING, MAPPING_PASSTHROUGH, TIMING_PHASING, ACCRUAL_TRUEUP), in
// DETAILED mode only. Refinement: diagnosis IMPROVES weak/boilerplate text, it
// never erases strong evidence — for the subject-bearing natures (OFFSET_TIMING,
// ACCRUAL_TRUEUP) a legacy sentence that already carries a safe vendor/memo
// subject is preserved. MAPPING_PASSTHROUGH and TIMING_PHASING never carry a
// subject, so they always take the owner wording. Absent / low-confidence /
// non-allowed diagnosis → exact legacy wording; conservative mode is untouched.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { generateNarrative } from '../src/lib/narrative/index.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'
import { diagnosisSentence, RENDERABLE_NATURES } from '../src/lib/enrich/diagnosisRender.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'
import { narrativeToDocxBlocks } from '../src/lib/export/docx.js'

// --- the approved NQ-5B copy ----------------------------------------------

const WORDING = {
  OFFSET_TIMING:
    'Related account activity appears broader than the reported variance, suggesting offsetting entries, timing, or account-level movement also affected the result.',
  MAPPING_PASSTHROUGH:
    'Recoveries or billbacks may lag expense recognition and should be reviewed against tenant recovery billing.',
  TIMING_PHASING:
    'Budgeted activity did not post during the period, suggesting a timing difference or deferred work rather than permanent savings.',
  ACCRUAL_TRUEUP:
    'Recorded activity appears consistent with accrual timing, reversals, or correcting entries rather than recurring operating activity.'
}

const VENDOR_NAMES = /Trinity|Armada|Bay City|Acme|Blue Shield|Recology|Pyro-?Comm|SFPUC|PG&E/i
const CAUSAL = /\b(due to|caused by|because of|driven by|drove|resulting from|attributable to|will|certainly|definitely|must)\b/i

// --- fixtures --------------------------------------------------------------

function rec({ account, actual, budget, accountType = 'expense', category = 'unfavorable' }) {
  const varianceAmount = actual - budget
  const variancePercent = budget === 0 ? null : (varianceAmount / Math.abs(budget)) * 100
  return {
    account, actual, budget, prior: null, varianceAmount, variancePercent,
    comparisonType: 'budget', thresholdTriggered: true, category, accountType,
    missingData: false, confidence: 90, sourceRows: [0]
  }
}

const GL_COLUMNS = ['Account', 'Date', 'Reference', 'Vendor', 'Description', 'Amount']

function build({ account, actual, budget, accountType, category, rows, mode = 'detailed' }) {
  const narrative = generateNarrative({
    fileId: 'base', fileName: 'IS.xlsx', baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{ period: 'current', comparisons: [rec({ account, actual, budget, accountType, category })] }]
  })
  const gl = {
    fileName: '4. General Ledger.pdf', status: 'ok', classification: { type: 'General Ledger (GL)' },
    normalized: {
      columns: GL_COLUMNS,
      rows: rows ? rows.map(([d, a]) => [account, '01/10/2026', '', '', d, String(a)]) : [['ZZZ Unrelated', '01/10/2026', '', '', 'Nothing', '1']]
    }
  }
  return enrichNarrative(narrative, { supporting: [gl], mode })
}

function noteOf(enriched, account) {
  const p = enriched.periods[0]
  return [].concat(p.highVariances || [], p.revenueNotes || [], p.expenseNotes || []).find((x) => x.account === account)
}

function sentenceCount(text) {
  return (String(text).match(/[.!?](\s|$)/g) || []).length
}

// --- new owner wording where the legacy S2 was weak/boilerplate or subjectless

test('OFFSET_TIMING (no safe subject) → owner wording', () => {
  // GL larger than the variance but the description is a bare reference → no
  // render-safe subject, so the legacy boilerplate is replaced.
  const note = noteOf(build({ account: '51305 HVAC Repairs', actual: 8000, budget: 5000, rows: [['INV 88231', 13000]] }), '51305 HVAC Repairs')
  assert.equal(note.diagnosis.nature, 'OFFSET_TIMING')
  assert.ok(note.text.endsWith(WORDING.OFFSET_TIMING), note.text)
})

test('MAPPING_PASSTHROUGH (recovery) → owner wording', () => {
  const note = noteOf(build({ account: '5100 Utility Expense Recovery', actual: 12700, budget: 5334, rows: [['Tenant utility recovery', 7400]] }), '5100 Utility Expense Recovery')
  assert.equal(note.diagnosis.nature, 'MAPPING_PASSTHROUGH')
  assert.ok(note.text.endsWith(WORDING.MAPPING_PASSTHROUGH), note.text)
})

test('TIMING_PHASING (zero-actual) → owner wording', () => {
  const note = noteOf(build({ account: '51150 Fire Sprinkler - Contract', actual: 0, budget: 18000 }), '51150 Fire Sprinkler - Contract')
  assert.equal(note.diagnosis.nature, 'TIMING_PHASING')
  assert.ok(note.text.endsWith(WORDING.TIMING_PHASING), note.text)
})

test('ACCRUAL_TRUEUP (no safe subject) → owner wording (no "moved opposite")', () => {
  // Negative actual, no GL match → ACCRUAL with no subject → safer-default wording.
  const note = noteOf(build({ account: '52000 Contra Expense', actual: -3000, budget: 1000, category: 'favorable' }), '52000 Contra Expense')
  assert.equal(note.diagnosis.nature, 'ACCRUAL_TRUEUP')
  assert.ok(note.text.endsWith(WORDING.ACCRUAL_TRUEUP), note.text)
  assert.doesNotMatch(note.text, /moved opposite|ran opposite/)
})

// every rendered owner sentence preserves S1 figures, is ≤ 2 sentences, names-free
for (const [account, input] of [
  ['51305 HVAC Repairs', { account: '51305 HVAC Repairs', actual: 8000, budget: 5000, rows: [['INV 88231', 13000]] }],
  ['5100 Utility Expense Recovery', { account: '5100 Utility Expense Recovery', actual: 12700, budget: 5334, rows: [['Tenant utility recovery', 7400]] }],
  ['51150 Fire Sprinkler - Contract', { account: '51150 Fire Sprinkler - Contract', actual: 0, budget: 18000 }],
  ['52000 Contra Expense', { account: '52000 Contra Expense', actual: -3000, budget: 1000, category: 'favorable' }]
]) {
  test(`${account}: rendered owner sentence preserves figures and is safe`, () => {
    const note = noteOf(build(input), account)
    assert.match(note.text, /^[^.]*\$[\d,]+[^.]*\([\d.]+%\)\./) // S1 keeps the figures
    assert.ok(sentenceCount(note.text) <= 2)
    assert.doesNotMatch(note.text, VENDOR_NAMES)
    assert.doesNotMatch(note.text, CAUSAL)
  })
}

// --- preserve strong evidence (subject-bearing natures) --------------------

test('OFFSET_TIMING with safe vendor/memo PRESERVES the legacy vendor-led sentence', () => {
  const note = noteOf(build({ account: '51200 Janitorial Contract', actual: 9000, budget: 5000, rows: [['Janitorial contract TRINITY BUILDING SERVICES', 12000]] }), '51200 Janitorial Contract')
  assert.equal(note.diagnosis.nature, 'OFFSET_TIMING')
  // The reviewer-approved vendor-led wording survives — diagnosis did not erase it.
  assert.match(note.text, /Janitorial contract from Trinity Building Services appears in the account detail/)
  assert.ok(!note.text.endsWith(WORDING.OFFSET_TIMING))
})

test('ACCRUAL_TRUEUP with safe subject PRESERVES the legacy direction-conflict sentence', () => {
  const note = noteOf(build({ account: '51201 Elevator Maintenance', actual: 8000, budget: 5000, rows: [['Maintenance charge', 3000], ['Prior-year over-accrual reversal', -25000]] }), '51201 Elevator Maintenance')
  assert.equal(note.diagnosis.nature, 'ACCRUAL_TRUEUP')
  assert.match(note.text, /ran opposite to the reported movement, consistent with credits or reversals/)
  assert.ok(!note.text.endsWith(WORDING.ACCRUAL_TRUEUP))
})

// --- identity / conservative-mode guarantees -------------------------------

test('non-renderable nature (REAL_SPEND) → exact legacy wording', () => {
  const note = noteOf(build({ account: '51299 Janitorial Supplies', actual: 4000, budget: 2000, rows: [['Janitorial supplies', 2000]] }), '51299 Janitorial Supplies')
  assert.equal(note.diagnosis.nature, 'REAL_SPEND')
  assert.match(note.text, /above plan for the period\.$/)
})

test('conservative mode is unchanged by NQ-5B', () => {
  const note = noteOf(build({ account: '5100 Utility Expense Recovery', actual: 12700, budget: 5334, rows: [['Tenant utility recovery', 7400]], mode: 'conservative' }), '5100 Utility Expense Recovery')
  assert.ok(!note.text.endsWith(WORDING.MAPPING_PASSTHROUGH))
})

// --- Markdown / DOCX parity -------------------------------------------------

test('Markdown and DOCX carry the same rendered owner sentence', () => {
  const enriched = build({ account: '5100 Utility Expense Recovery', actual: 12700, budget: 5334, rows: [['Tenant utility recovery', 7400]] })
  const md = narrativeToMarkdown(enriched)
  const docx = JSON.stringify(narrativeToDocxBlocks(enriched))
  assert.ok(md.includes(WORDING.MAPPING_PASSTHROUGH), 'Markdown carries the sentence')
  assert.ok(docx.includes(WORDING.MAPPING_PASSTHROUGH), 'DOCX carries the sentence')
})

// --- the rendering gate (pure) ---------------------------------------------

test('diagnosisSentence: only the four approved natures render', () => {
  assert.deepEqual([...RENDERABLE_NATURES].sort(), ['ACCRUAL_TRUEUP', 'MAPPING_PASSTHROUGH', 'OFFSET_TIMING', 'TIMING_PHASING'])
  assert.equal(diagnosisSentence({ nature: 'REAL_SPEND', confidence: 'high' }), null)
  assert.equal(diagnosisSentence({ nature: 'INDETERMINATE', confidence: 'low' }), null)
  assert.equal(diagnosisSentence(null), null)
})

test('diagnosisSentence: confidence below medium does not render', () => {
  assert.equal(diagnosisSentence({ nature: 'OFFSET_TIMING', confidence: 'low' }), null)
  assert.equal(diagnosisSentence({ nature: 'OFFSET_TIMING', confidence: 'medium' }), WORDING.OFFSET_TIMING)
  assert.equal(diagnosisSentence({ nature: 'OFFSET_TIMING', confidence: 'high' }), WORDING.OFFSET_TIMING)
})

test('every rendered sentence is free of names and causation', () => {
  for (const nature of RENDERABLE_NATURES) {
    const s = diagnosisSentence({ nature, confidence: 'high' })
    assert.doesNotMatch(s, VENDOR_NAMES)
    assert.doesNotMatch(s, CAUSAL)
  }
})
