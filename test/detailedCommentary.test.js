// Detailed commentary rendering tests — Phase 21.3.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Phase 21.3 adds an OPT-IN detailed commentary mode that renders a sanitized
// vendor/memo phrase (from the Phase 21.2 `detailEvidence`) into the GL sentence.
// These tests prove:
//   • default (conservative) output is byte-identical to no-mode output,
//   • detailed mode renders vendor/memo when render-safe (high/medium),
//   • low-confidence / generic evidence falls back to the conservative sentence,
//   • no unsafe token (date / reference / money / page-bleed / raw caps blob)
//     and no causal language ever reaches the detailed output,
//   • offset-heavy and disproportionate variants render their approved wording,
//   • output is deterministic, and the Markdown export reflects the mode.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { enrichNarrative } from '../src/lib/enrich/index.js'
import { detailedCommentarySentence } from '../src/lib/enrich/templates.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'

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

// A fixed, non-sensitive corpus exercising every detailed path. The Vendor
// column is intentionally empty (the real MRI case) so the vendor/memo are mined
// from the dirty Description blob by Phase 21.1 and gated by Phase 21.2.
function build(mode) {
  const comparisons = [
    rec({ account: '51252 Janitorial Supplies', actual: 9000, budget: 5000 }),        // vendor+memo, high
    rec({ account: '51020 Utility-Building Water', actual: 3100, budget: 1000 }),       // vendor+memo, medium
    rec({ account: '51256 Trash Removal', actual: 4000, budget: 1000 }),               // memo only
    rec({ account: '51257 Recology Hauling', actual: 4000, budget: 1000 }),            // vendor only
    rec({ account: '51999 Misc', actual: 4000, budget: 1000 }),                         // generic → fallback
    rec({ account: '51400 Fire Sprinkler Contract', actual: 12000, budget: 5000, accountType: 'unknown', category: 'neutral' }), // offset-heavy
    rec({ account: '54200 Insurance', actual: 6000, budget: 5000 })                     // disproportionate
  ]
  const narrative = generateNarrative({
    fileId: 'base',
    fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{ period: 'current', comparisons }]
  })
  const gl = {
    fileName: '4. General Ledger.pdf',
    status: 'ok',
    classification: { type: 'General Ledger (GL)' },
    normalized: {
      columns: GL_COLUMNS,
      rows: [
        ['51252 Janitorial Supplies', '01/05/2026', '3506', '', 'Janitorial supply TRINITY BUILDING SERVICES', '4000'],
        ['51020 Utility-Building Water', '01/15/2026', '', '', 'Monthly water CITY WATER DEPT', '2100'],
        ['51256 Trash Removal', '01/16/2026', '', '', 'Monthly trash pickup', '3000'],
        ['51257 Recology Hauling', '01/17/2026', '', '', 'RECOLOGY GOLDEN GATE', '3000'],
        ['51999 Misc', '01/30/2026', '', '', 'Service', '3000'],
        ['51400 Fire Sprinkler Contract', '01/10/2026', '', '', 'Annual fire contract ACME FIRE LLC', '23200'],
        ['51400 Fire Sprinkler Contract', '01/22/2026', '', '', 'Annual fire contract ACME FIRE LLC', '-12500'],
        ['54200 Insurance', '01/12/2026', '', '', 'Annual premium BLUE SHIELD INSURANCE', '25000']
      ]
    }
  }
  return enrichNarrative(narrative, mode === undefined ? { supporting: [gl] } : { supporting: [gl], mode })
}

function findNote(enriched, account) {
  for (const p of enriched.periods) {
    for (const k of ['highVariances', 'expenseNotes', 'revenueNotes']) {
      const n = (p[k] || []).find((x) => x.account === account)
      if (n) return n
    }
  }
  return null
}

// Count sentences (terminal punctuation followed by whitespace or end of string).
// A trailing corporate "." (Inc./LLC.) is stripped from a rendered vendor, so it
// never reads as a false boundary.
function sentences(text) {
  return (String(text).match(/[.!?](?:\s|$)/g) || []).length
}

// --- 1. default conservative output is byte-identical -----------------------

test('default mode equals explicit conservative mode (byte-identical)', () => {
  assert.equal(narrativeToMarkdown(build(undefined)), narrativeToMarkdown(build('conservative')))
})

test('an unknown mode is treated conservatively (no detail rendered)', () => {
  assert.equal(narrativeToMarkdown(build('something-else')), narrativeToMarkdown(build('conservative')))
})

test('detailed mode actually differs from conservative (opt-in has an effect)', () => {
  assert.notEqual(narrativeToMarkdown(build('detailed')), narrativeToMarkdown(build('conservative')))
})

// --- 2. detailed mode renders vendor/memo when render-safe ------------------

test('detailed mode renders an explanation for a high-confidence note', () => {
  const note = findNote(build('detailed'), '51252 Janitorial Supplies')
  // NQ-2A.1: a single explanation sentence (S2) folds the implication in. This
  // aligned expense overspend reads as a below/above-plan explanation.
  assert.match(note.text, /Janitorial supplies from Trinity Building Services was above plan for the period\.$/)
  assert.ok(sentences(note.text) <= 2, `>2 sentences: ${note.text}`)
})

test('detailed mode renders an explanation for a medium-confidence note', () => {
  const note = findNote(build('detailed'), '51020 Utility-Building Water')
  // "Monthly" is a recurring signal → recurring explanation.
  assert.match(note.text, /Monthly water from City Water Dept appears to explain the variance and may represent recurring activity\.$/)
})

test('detailed mode renders a memo-only explanation', () => {
  const note = findNote(build('detailed'), '51256 Trash Removal')
  assert.match(note.text, /Monthly trash pickup appears to explain the variance and may represent recurring activity\.$/)
})

test('detailed mode renders a vendor-only explanation', () => {
  const note = findNote(build('detailed'), '51257 Recology Hauling')
  assert.match(note.text, /Activity from Recology Golden Gate was above plan for the period\.$/)
})

// --- offset-heavy and disproportionate variants ----------------------------

test('detailed mode renders the offset-heavy explanation', () => {
  const note = findNote(build('detailed'), '51400 Fire Sprinkler Contract')
  assert.match(note.text, /Activity exceeded the reported variance, suggesting offsetting entries or timing effects influenced the reported result\.$/)
  assert.ok(sentences(note.text) <= 2)
})

test('detailed mode renders the disproportionate explanation without a dollar', () => {
  const note = findNote(build('detailed'), '54200 Insurance')
  assert.match(note.text, /Observed activity exceeded the reported variance, suggesting net account movement was influenced by additional offsets\.$/)
  assert.doesNotMatch(note.text, /\$25,000|25,000/)
  assert.ok(sentences(note.text) <= 2)
})

// --- 3. low-confidence / generic evidence does not render -------------------

test('a generic / low-confidence note falls back to the conservative sentence', () => {
  const detailed = findNote(build('detailed'), '51999 Misc')
  const conservative = findNote(build('conservative'), '51999 Misc')
  // No render-safe subject and no supported implication → the explanation falls
  // back to the conservative evidence sentence (no unsupported implication).
  assert.equal(detailed.text, conservative.text, 'detailed falls back to the conservative S2')
  // The generic "Service" vendor must never surface as a rendered vendor phrase.
  assert.doesNotMatch(detailed.text, /from Service/)
})

test('a dropped Description (leading line number) never renders the literal "null"', () => {
  // The matcher's detail summarizer treats a Description that starts with a
  // numeric token as numeric and drops it (detail.description → null). Detailed
  // mode must coerce that to a clean fallback, never "Detail includes null".
  const comparisons = [rec({ account: '54110 Real Estate Taxes', actual: 9000, budget: 4000 })]
  const narrative = generateNarrative({
    fileId: 'base', fileName: 'Comparative Income Statement.xlsx', baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 }, comparisonSets: [{ period: 'current', comparisons }]
  })
  const gl = {
    fileName: '4. General Ledger.pdf', status: 'ok', classification: { type: 'General Ledger (GL)' },
    normalized: { columns: GL_COLUMNS, rows: [['54110 Real Estate Taxes', '01/07/2026', '0134', '', '1304 2nd Installment SAN FRANCISCO TAX COLLECTOR', '5000']] }
  }
  const detailed = enrichNarrative(narrative, { supporting: [gl], mode: 'detailed' })
  const conservative = enrichNarrative(narrative, { supporting: [gl] })
  const dNote = findNote(detailed, '54110 Real Estate Taxes')
  assert.doesNotMatch(dNote.text, /\bnull\b/)
  // No render-safe subject survives the dropped Description, so the explanation
  // falls back to the same clean conservative evidence sentence.
  assert.equal(dNote.text, findNote(conservative, '54110 Real Estate Taxes').text)
})

// --- 4. no unsafe tokens / causal language in detailed output --------------

test('detailed Markdown leaks no date, reference, raw-caps vendor, GL dollar, or causal phrase', () => {
  const md = narrativeToMarkdown(build('detailed'))
  assert.doesNotMatch(md, /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/) // dates
  assert.doesNotMatch(md, /\bINV\b|\bAP \d|\bGS \d|#\s*\d/) // references
  assert.doesNotMatch(md, /TRINITY BUILDING SERVICES|CITY WATER DEPT|ACME FIRE LLC|BLUE SHIELD INSURANCE|RECOLOGY GOLDEN GATE/) // raw caps blobs
  assert.doesNotMatch(md, /General Ledger\.pdf|Supporting file/) // file name
  assert.doesNotMatch(md, /\$23,200|\$25,000|\$10,700/) // suppressed / raw GL amounts
  assert.doesNotMatch(md, /\b(caused by|due to|because of|driven by|drove|resulting from|explains)\b/i) // causation ("explains" asserts cause; hedged "appears to explain" is allowed)
})

// --- 5. deterministic -------------------------------------------------------

test('detailed output is deterministic', () => {
  assert.equal(narrativeToMarkdown(build('detailed')), narrativeToMarkdown(build('detailed')))
})

// --- 6. unit-level guards on the pure builder ------------------------------

test('detailedCommentarySentence does not render low/none confidence', () => {
  for (const c of ['low', 'none']) {
    const out = detailedCommentarySentence({
      evidence: { evidenceConfidence: c, vendorRenderable: true, vendor: 'Acme LLC', memoRenderable: false, memo: null },
      contribution: { contributionType: 'aligned' },
      period: 'current'
    })
    assert.equal(out, null, `confidence=${c} must not render`)
  }
})

test('detailedCommentarySentence returns null with no render-safe field', () => {
  const out = detailedCommentarySentence({
    evidence: { evidenceConfidence: 'medium', vendorRenderable: false, vendor: null, memoRenderable: false, memo: null },
    contribution: { contributionType: 'aligned' },
    period: 'current'
  })
  assert.equal(out, null)
})

test('detailedCommentarySentence yields to the conservative warning on a direction conflict', () => {
  const out = detailedCommentarySentence({
    evidence: { evidenceConfidence: 'high', vendorRenderable: true, vendor: 'Acme LLC', memoRenderable: true, memo: 'Repair' },
    contribution: { contributionType: 'direction-conflict' },
    period: 'current'
  })
  assert.equal(out, null)
})

test('detailedCommentarySentence is period-aware (year-to-date)', () => {
  const out = detailedCommentarySentence({
    evidence: { evidenceConfidence: 'medium', vendorRenderable: true, vendor: 'Recology Golden Gate', memoRenderable: false, memo: null },
    contribution: { contributionType: 'aligned' },
    period: 'ytd'
  })
  assert.equal(out, 'The variance reflects activity from Recology Golden Gate year-to-date.')
})
