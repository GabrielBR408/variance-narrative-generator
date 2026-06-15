// Supporting-file enrichment tests — Phase 15.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Covers the deterministic client-side enrichment layer: base-only narratives
// stay byte-identical, evidence attaches only to flagged variance notes by
// confident match, weak/partial matches are gated by the confidence floor,
// multiple files produce a stable citation order, citations name the file and
// invent no figures, and the appended text flows identically into Markdown and
// DOCX.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeVariance } from '../src/lib/variance/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'
import { narrativeToDocxBlocks } from '../src/lib/export/docx.js'
import {
  enrichNarrative,
  scoreMatch,
  buildEvidenceIndex,
  normalizeName,
  accountCode,
  CONFIDENCE_FLOOR
} from '../src/lib/enrich/index.js'

// --- helpers ---------------------------------------------------------------

// A comparison record matching calculate.js output, self-consistent so the
// narrative engine produces real sentences. (Shared shape with the other tests.)
function rec({ account, actual, budget = null, prior = null, accountType, category, sourceRows }) {
  const comparison = budget !== null ? budget : prior
  const comparisonType = budget !== null ? 'budget' : prior !== null ? 'prior' : null
  const hasActual = typeof actual === 'number'
  const hasComparison = typeof comparison === 'number'
  const varianceAmount = hasActual && hasComparison ? actual - comparison : null
  const variancePercent =
    varianceAmount === null || comparison === 0 ? null : (varianceAmount / Math.abs(comparison)) * 100
  const thresholdTriggered =
    varianceAmount !== null &&
    (Math.abs(varianceAmount) >= 1000 || (variancePercent !== null && Math.abs(variancePercent) >= 10))
  return {
    account,
    actual: hasActual ? actual : null,
    budget,
    prior,
    varianceAmount,
    variancePercent,
    comparisonType,
    thresholdTriggered,
    category,
    accountType,
    missingData: !hasActual || !hasComparison,
    confidence: 90,
    sourceRows: sourceRows || []
  }
}

function baseNarrative(comparisons) {
  return generateNarrative({
    fileId: 'base',
    fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{ period: 'current', comparisons }]
  })
}

// A supporting extraction shaped like the browser's normalized output.
function supporting({ fileName, type, columns, rows }) {
  return { fileName, status: 'ok', classification: { type }, normalized: { columns, rows } }
}

const GL = (fileName = 'General Ledger.pdf') =>
  supporting({
    fileName,
    type: 'General Ledger (GL)',
    columns: ['Account', 'Amount'],
    rows: [
      ['5100 Utility Expense Recovery', '7366'],
      ['6000 Office Supplies', '120']
    ]
  })

const FLAGGED = [
  rec({ account: 'Utility Expense Recovery', actual: 12700, budget: 5334, accountType: 'expense', category: 'unfavorable', sourceRows: [4] })
]

// --- base-only is byte-identical -------------------------------------------

test('no supporting files: narrative is returned unchanged (same reference)', () => {
  const n = baseNarrative(FLAGGED)
  assert.equal(enrichNarrative(n, { supporting: [] }), n)
})

test('supporting files but no match: narrative unchanged and Markdown byte-identical', () => {
  const n = baseNarrative(FLAGGED)
  const noMatch = GL('General Ledger.pdf')
  noMatch.normalized.rows = [['9999 Landscaping', '50'], ['8888 Parking', '75']]
  const before = narrativeToMarkdown(n)
  const enriched = enrichNarrative(n, { supporting: [noMatch] })
  assert.equal(enriched, n) // identity preserved when nothing attaches
  assert.equal(narrativeToMarkdown(enriched), before)
})

// --- evidence attaches to a matching flagged note --------------------------

test('GL evidence attaches to the matching flagged note', () => {
  const n = baseNarrative(FLAGGED)
  const enriched = enrichNarrative(n, { supporting: [GL()] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  assert.ok(note.enriched, 'note should be marked enriched')
  assert.equal(note.support.length, 1)
  assert.equal(note.support[0].fileName, 'General Ledger.pdf')
  // Original variance sentence is preserved, with the citation appended.
  assert.match(note.text, /^Utility Expense Recovery exceeded budget by \$7,366 \(138\.1%\)\. /)
  assert.match(note.text, /Supporting file "General Ledger\.pdf" contains matching ledger activity for Utility Expense Recovery\.$/)
})

test('the same evidence appears on the matching expense-notes entry too', () => {
  const n = baseNarrative(FLAGGED)
  const enriched = enrichNarrative(n, { supporting: [GL()] })
  const note = enriched.periods[0].expenseNotes.find((x) => x.account === 'Utility Expense Recovery')
  assert.ok(note.support && note.support.length === 1)
})

// --- gating: only flagged variance notes are enriched ----------------------

test('a missing-data note is never enriched even when its account matches', () => {
  const n = baseNarrative([
    rec({ account: 'Utility Expense Recovery', actual: null, budget: 5000, accountType: 'expense', category: 'unfavorable', sourceRows: [4] })
  ])
  const enriched = enrichNarrative(n, { supporting: [GL()] })
  const md = enriched.periods[0].missingData[0]
  assert.ok(!md.support, 'missing-data note must not carry evidence')
  assert.doesNotMatch(md.text, /Supporting file/)
})

test('a sub-threshold line produces no note, so it is never enriched', () => {
  // $200 / 4% — below both thresholds; not narrated at all.
  const n = baseNarrative([
    rec({ account: 'Utility Expense Recovery', actual: 5200, budget: 5000, accountType: 'expense', category: 'unfavorable', sourceRows: [4] })
  ])
  const enriched = enrichNarrative(n, { supporting: [GL()] })
  assert.equal(enriched.periods[0].highVariances.length, 0)
  assert.equal(enriched, n) // nothing flagged → nothing changed
})

// --- confidence floor ------------------------------------------------------

test('a partial token overlap scores below the floor and does not attach', () => {
  const idx = buildEvidenceIndex([
    supporting({ fileName: 'Notes.pdf', type: 'Supporting Document', columns: ['Account'], rows: [['Utility Expense Insurance']] })
  ])
  const score = scoreMatch('Utility Expense Recovery', idx[0])
  assert.ok(score < CONFIDENCE_FLOOR, `expected < ${CONFIDENCE_FLOOR}, got ${score}`)

  const n = baseNarrative(FLAGGED)
  const enriched = enrichNarrative(n, {
    supporting: [supporting({ fileName: 'Notes.pdf', type: 'Supporting Document', columns: ['Account'], rows: [['Utility Expense Insurance']] })]
  })
  assert.equal(enriched, n) // below floor → no attachment, identity preserved
})

test('scoreMatch tiers: code exact > name exact > substring', () => {
  const [byCode] = buildEvidenceIndex([supporting({ fileName: 'a', type: '', columns: ['Account'], rows: [['5100 Utilities']] })])
  assert.equal(scoreMatch('5100 Utility Expense Recovery', byCode), 1.0)
  const [byName] = buildEvidenceIndex([supporting({ fileName: 'a', type: '', columns: ['Account'], rows: [['Utility Expense Recovery']] })])
  assert.equal(scoreMatch('Utility Expense Recovery', byName), 0.9)
  const [bySub] = buildEvidenceIndex([supporting({ fileName: 'a', type: '', columns: ['Account'], rows: [['Total Utility Expense Recovery Detail']] })])
  assert.equal(scoreMatch('Utility Expense Recovery', bySub), 0.7)
})

// --- multiple files: deterministic order + dedupe --------------------------

test('multiple matching files cite in stable file-name order', () => {
  const n = baseNarrative(FLAGGED)
  const budget = supporting({
    fileName: 'Budget Detail.xlsx',
    type: 'Budget',
    columns: ['Account', 'Budget'],
    rows: [['Utility Expense Recovery', '5334']]
  })
  // Pass the GL last to prove ordering is by file name, not input order.
  const enriched = enrichNarrative(n, { supporting: [budget, GL('General Ledger.pdf')] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  assert.deepEqual(note.support.map((s) => s.fileName), ['Budget Detail.xlsx', 'General Ledger.pdf'])
  assert.match(note.support[0].text, /includes budget detail matching/)
  assert.match(note.support[1].text, /contains matching ledger activity/)
})

test('repeated rows in one file collapse to a single citation with all source rows', () => {
  const dupes = supporting({
    fileName: 'General Ledger.pdf',
    type: 'General Ledger (GL)',
    columns: ['Account', 'Amount'],
    rows: [
      ['Utility Expense Recovery', '4000'],
      ['Office Supplies', '10'],
      ['Utility Expense Recovery', '3366']
    ]
  })
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [dupes] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  assert.equal(note.support.length, 1)
  assert.deepEqual(note.support[0].sourceRows, [0, 2])
})

// --- citation quality ------------------------------------------------------

test('citations name the supporting file and invent no figures', () => {
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [GL('General Ledger.pdf')] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  const citation = note.support[0].text
  assert.ok(citation.includes('General Ledger.pdf'))
  assert.doesNotMatch(citation, /\$/, 'citation must not contain a dollar figure')
  assert.doesNotMatch(citation, /\d/, 'citation must not contain any digit')
  assert.doesNotMatch(citation, /caused|because|due to/i, 'citation must not assert causation')
})

// --- export parity ---------------------------------------------------------

test('Markdown and DOCX carry the enriched note text identically', () => {
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [GL('General Ledger.pdf')] })
  const md = narrativeToMarkdown(enriched)
    .split(/^## /m)
    .slice(1)
    .flatMap((chunk) => chunk.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)))
  const dx = narrativeToDocxBlocks(enriched).filter((b) => b.kind === 'bullet').map((b) => b.text)
  assert.deepEqual(md, dx)
  // And the citation actually made it into both.
  assert.ok(md.some((t) => /Supporting file "General Ledger\.pdf"/.test(t)))
})

// --- normalize / code helpers ----------------------------------------------

test('normalizeName strips a leading code and punctuation', () => {
  assert.equal(normalizeName('5100 · Utility Expense Recovery'), 'utility expense recovery')
  assert.equal(normalizeName('Utility Expense Recovery'), 'utility expense recovery')
  assert.equal(accountCode('5100 Utility Expense Recovery'), '5100')
  assert.equal(accountCode('Utility Expense Recovery'), '')
})
