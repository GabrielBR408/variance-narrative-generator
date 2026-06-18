// Diagnosis consumption tests — NQ-5B.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// NQ-5B renders the NQ-5A/5A.1 diagnosis metadata as owner-facing wording for a
// small allow-list of natures (OFFSET_TIMING, MAPPING_PASSTHROUGH, TIMING_PHASING,
// ACCRUAL_TRUEUP), in DETAILED mode only. These tests pin the approved copy, the
// identity guarantees (diagnosis absent → byte-identical; conservative unchanged),
// Markdown/DOCX parity, and the no-names / no-causality safety nets.

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
    'Activity exceeded the reported variance and appears influenced by offsetting entries, timing, or account-level movement during the period.',
  MAPPING_PASSTHROUGH:
    'Recoverable charges appear to lag expense recognition and may normalize as billing activity occurs.',
  TIMING_PHASING:
    'Budgeted activity does not appear to have occurred during the period and may reflect timing rather than permanent savings.',
  ACCRUAL_TRUEUP:
    'Recorded activity moved opposite the reported variance and appears consistent with accrual timing, reversals, or correcting entries.'
}

// Vendor names that must NEVER appear in the rendered owner sentence.
const VENDOR_NAMES = /Trinity|Armada|Bay City|Acme|Blue Shield|Recology|Pyro-?Comm|SFPUC|PG&E/i
// Causation / certainty language that must never appear.
const CAUSAL = /\b(due to|caused by|because of|driven by|drove|resulting from|attributable to|will|certainly|definitely|must)\b/i

// --- fixtures (mirror the canonical weak-report shapes) --------------------

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

// Build a one-account flagged narrative and enrich it. `rows` are [description,
// amount] GL pairs (vendor mined from the dirty Description blob — the MRI shape);
// omit `rows` for an unmatched line (a non-matching GL still runs the pass).
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
  return { narrative, enriched: enrichNarrative(narrative, { supporting: [gl], mode }) }
}

function noteOf(enriched, account) {
  const p = enriched.periods[0]
  return [].concat(p.highVariances || [], p.revenueNotes || [], p.expenseNotes || []).find((x) => x.account === account)
}

// The six representative weak-report lines from the spec.
const CASES = {
  'HVAC Contract': { input: { account: '51300 HVAC Contract', actual: 8000, budget: 5000, rows: [['HVAC maintenance BAY CITY MECHANICAL', 13000]] }, nature: 'OFFSET_TIMING' },
  'Janitorial Contract': { input: { account: '51200 Janitorial Contract', actual: 9000, budget: 5000, rows: [['Janitorial contract TRINITY BUILDING SERVICES', 12000]] }, nature: 'OFFSET_TIMING' },
  'Security Contract': { input: { account: '51100 Security Contract', actual: 9000, budget: 3000, rows: [['Security monitoring ARMADA SECURITY', 15000]] }, nature: 'OFFSET_TIMING' },
  'Utility Expense Recovery': { input: { account: '5100 Utility Expense Recovery', actual: 12700, budget: 5334, rows: [['Tenant utility recovery', 7400]] }, nature: 'MAPPING_PASSTHROUGH' },
  'Fire Sprinkler': { input: { account: '51150 Fire Sprinkler - Contract', actual: 0, budget: 18000 }, nature: 'TIMING_PHASING' },
  'Elevator Maintenance': { input: { account: '51201 Elevator Maintenance', actual: 8000, budget: 5000, rows: [['Maintenance charge', 3000], ['Prior-year over-accrual reversal', -25000]] }, nature: 'ACCRUAL_TRUEUP' }
}

// --- per-line wording -------------------------------------------------------

for (const [label, { input, nature }] of Object.entries(CASES)) {
  test(`${label} → ${nature} owner wording`, () => {
    const note = noteOf(build(input).enriched, input.account)
    assert.equal(note.diagnosis.nature, nature)
    assert.ok(note.text.endsWith(WORDING[nature]), `unexpected wording: ${note.text}`)
    // S1 (the variance figures) is preserved ahead of the rendered S2.
    assert.match(note.text, /^[^.]*\$[\d,]+[^.]*\([\d.]+%\)\./)
    // Two sentences max; no vendor names; no causation.
    assert.ok((note.text.match(/[.!?](\s|$)/g) || []).length <= 2)
    assert.doesNotMatch(note.text, VENDOR_NAMES)
    assert.doesNotMatch(note.text, CAUSAL)
  })
}

// --- identity: diagnosis absent → byte-identical ---------------------------

test('non-renderable nature → exact legacy wording (REAL_SPEND is not in the allow-list)', () => {
  // Aligned single-transaction spend → REAL_SPEND, which NQ-5B does not render.
  const { enriched } = build({ account: '51299 Janitorial Supplies', actual: 4000, budget: 2000, rows: [['Janitorial supplies', 2000]] })
  const note = noteOf(enriched, '51299 Janitorial Supplies')
  assert.equal(note.diagnosis.nature, 'REAL_SPEND')
  // Legacy NQ-2A.1 aligned explanation stands — no diagnosis wording.
  assert.match(note.text, /above plan for the period\.$/)
  assert.doesNotMatch(note.text, new RegExp(WORDING.OFFSET_TIMING.slice(0, 30)))
})

test('conservative mode is unchanged by NQ-5B (renderable nature, legacy wording stands)', () => {
  const conservative = noteOf(build({ ...CASES['HVAC Contract'].input, mode: 'conservative' }).enriched, '51300 HVAC Contract')
  // The diagnosis is still attached as metadata, but conservative wording is not overridden.
  assert.ok(!conservative.text.endsWith(WORDING.OFFSET_TIMING))
})

// --- Markdown / DOCX parity -------------------------------------------------

test('Markdown and DOCX carry the same rendered owner sentence', () => {
  const { enriched } = build(CASES['Utility Expense Recovery'].input)
  const md = narrativeToMarkdown(enriched)
  const docx = JSON.stringify(narrativeToDocxBlocks(enriched))
  assert.ok(md.includes(WORDING.MAPPING_PASSTHROUGH), 'Markdown carries the sentence')
  assert.ok(docx.includes(WORDING.MAPPING_PASSTHROUGH), 'DOCX carries the sentence')
})

// --- the rendering gate -----------------------------------------------------

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
