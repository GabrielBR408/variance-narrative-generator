// Supporting-file enrichment tests — Phase 15 / 16.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Covers the deterministic client-side enrichment layer: base-only narratives
// stay byte-identical, evidence attaches only to flagged variance notes by
// confident match, weak/partial matches are gated by the confidence floor,
// multiple files produce a stable order, and the merged text flows identically
// into Markdown and DOCX.
//
// Phase 16: the rendered owner text is an explanation clause merged into the
// variance sentence — never a "Supporting file" citation, never a file name.
// GL "thick" evidence (a matched amount/description) may phrase a cause; "thin"
// name-only evidence and budget-only evidence stay conservative; wording is
// period-aware; structured `support` metadata remains for tooling/tests.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeVariance } from '../src/lib/variance/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { scopeNarrative } from '../src/lib/narrative/periodScope.js'
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

test('GL thick evidence merges an owner-facing explanation into the sentence', () => {
  const n = baseNarrative(FLAGGED)
  const enriched = enrichNarrative(n, { supporting: [GL()] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  assert.ok(note.enriched, 'note should be marked enriched')
  assert.equal(note.support.length, 1)
  assert.equal(note.support[0].fileName, 'General Ledger.pdf')
  assert.equal(note.support[0].thick, true, 'GL row with an Amount column is thick')
  // The original variance amount + percent are preserved, and the explanation is
  // merged into the SAME sentence (single period at the end), now including the
  // Phase 17 GL-detail summary.
  assert.match(
    note.text,
    /^Utility Expense Recovery exceeded budget by \$7,366 \(138\.1%\), primarily due to higher current-period .*charges shown in the GL detail, including 1 matching entry totaling approximately \$7,400\.$/
  )
  // No citation / file-name / debug language leaks into the owner text.
  assert.doesNotMatch(note.text, /Supporting file/)
  assert.doesNotMatch(note.text, /General Ledger\.pdf/)
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
  assert.doesNotMatch(md.text, /Supporting file|GL detail|General Ledger\.pdf/)
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

test('multiple matching files: support keeps stable file-name order, GL phrases the clause', () => {
  const n = baseNarrative(FLAGGED)
  const budget = supporting({
    fileName: 'Budget Detail.xlsx',
    type: 'Budget',
    columns: ['Account', 'Budget'],
    rows: [['Utility Expense Recovery', '5334']]
  })
  // Pass the GL last to prove support order is by file name, not input order.
  const enriched = enrichNarrative(n, { supporting: [budget, GL('General Ledger.pdf')] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  // All matches retained in metadata, stable order.
  assert.deepEqual(note.support.map((s) => s.fileName), ['Budget Detail.xlsx', 'General Ledger.pdf'])
  // GL outranks budget, so the merged owner clause is the GL explanation.
  assert.match(note.text, /shown in the GL detail, including 1 matching entry totaling approximately \$7,400\.$/)
  assert.doesNotMatch(note.text, /budget assumptions/)
  assert.doesNotMatch(note.text, /Budget Detail\.xlsx|General Ledger\.pdf|Supporting file/)
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

// --- owner-facing text: base figure preserved, only a rounded GL aggregate added

test('explanation preserves the base amount/percent and adds only a rounded GL aggregate', () => {
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [GL('General Ledger.pdf')] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  // The base variance figure is preserved verbatim.
  assert.ok(note.text.includes('$7,366 (138.1%)'), 'base variance figure preserved')
  // The only additional money is the rounded GL aggregate, flagged "approximately"
  // so it never reads as a fabricated exact figure.
  assert.match(note.text, /approximately \$7,400\b/)
  const monies = note.text.match(/\$[\d,]+(?:\.\d+)?/g) || []
  assert.deepEqual(monies, ['$7,366', '$7,400'], 'base figure + one rounded GL aggregate only')
  // The raw matched amount (7366) is never re-quoted verbatim as its own figure.
  assert.doesNotMatch(note.text.replace('$7,366', ''), /7366/)
})

// --- Phase 17: GL detail summaries -----------------------------------------

test('GL detail names a recurring vendor and a reliable total', () => {
  const gl = supporting({
    fileName: 'General Ledger.pdf',
    type: 'General Ledger (GL)',
    columns: ['Account', 'Vendor', 'Amount'],
    rows: [
      ['Utility Expense Recovery', 'PG&E', '4000'],
      ['Utility Expense Recovery', 'PG&E', '3400'],
      ['Office Supplies', 'Staples', '10']
    ]
  })
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [gl] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  const detail = note.support[0].detail
  assert.equal(detail.count, 2)
  assert.equal(detail.total, 7400)
  assert.equal(detail.topVendor, 'PG&E')
  assert.equal(detail.topVendorCount, 2)
  assert.match(note.text, /including PG&E activity totaling approximately \$7,400\./)
})

test('GL total is omitted when amounts are ambiguous (Debit + Credit columns)', () => {
  const gl = supporting({
    fileName: 'General Ledger.pdf',
    type: 'General Ledger (GL)',
    columns: ['Account', 'Debit', 'Credit'],
    rows: [
      ['Utility Expense Recovery', '4000', ''],
      ['Utility Expense Recovery', '3366', '']
    ]
  })
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [gl] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  const detail = note.support[0].detail
  assert.equal(detail.count, 2)
  assert.equal(detail.total, null, 'two amount columns are ambiguous → no total')
  // Count wording, but NO "totaling approximately" since the total is unreliable.
  assert.match(note.text, /including 2 matching entries\./)
  assert.doesNotMatch(note.text, /totaling approximately/)
})

test('a single stray vendor is not asserted as the vendor (no invention)', () => {
  const gl = supporting({
    fileName: 'General Ledger.pdf',
    type: 'General Ledger (GL)',
    columns: ['Account', 'Description', 'Amount'],
    rows: [
      ['Utility Expense Recovery', 'PG&E', '4000'],
      ['Utility Expense Recovery', 'City Water', '3400']
    ]
  })
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [gl] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  // No vendor recurs, so wording falls back to entry count — no name is asserted.
  assert.doesNotMatch(note.text, /PG&E|City Water/)
  assert.match(note.text, /including 2 matching entries totaling approximately \$7,400\./)
})

test('no enriched owner text contains "Supporting file" or an uploaded file name', () => {
  const budget = supporting({
    fileName: 'Annual Budget 2026.xlsx',
    type: 'Budget',
    columns: ['Account', 'Budget'],
    rows: [['Utility Expense Recovery', '5334']]
  })
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [GL('4. General Ledger.pdf'), budget] })
  const allText = narrativeToMarkdown(enriched)
  assert.doesNotMatch(allText, /Supporting file/)
  assert.doesNotMatch(allText, /General Ledger\.pdf/)
  assert.doesNotMatch(allText, /Annual Budget 2026\.xlsx/)
  assert.doesNotMatch(allText, /source row|sourceRow|debug/i)
})

// --- GL thin vs thick -------------------------------------------------------

test('GL thin evidence (name-only, no amount/description) stays conservative', () => {
  const thinGL = supporting({
    fileName: 'General Ledger.pdf',
    type: 'General Ledger (GL)',
    columns: ['Account'],
    rows: [['Utility Expense Recovery'], ['Office Supplies']]
  })
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [thinGL] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  assert.equal(note.support[0].thick, false)
  assert.match(note.text, /with matching GL activity supporting the variance\.$/)
  assert.doesNotMatch(note.text, /primarily due to|shown in the GL detail/)
})

// --- budget-only evidence ---------------------------------------------------

test('budget-only evidence uses conservative, non-causal language', () => {
  const budget = supporting({
    fileName: 'Budget Detail.xlsx',
    type: 'Budget',
    columns: ['Account', 'Budget'],
    rows: [['Utility Expense Recovery', '5334']]
  })
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [budget] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  assert.match(note.text, /compared against scheduled budget assumptions for the period\.$/)
  assert.doesNotMatch(note.text, /primarily due to|caused|because/i)
})

// --- period-aware wording ---------------------------------------------------

test('YTD period uses year-to-date wording, never "current-period"', () => {
  const ytd = generateNarrative({
    fileId: 'base',
    fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{ period: 'ytd', comparisons: FLAGGED }]
  })
  const enriched = enrichNarrative(ytd, { supporting: [GL()] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  assert.match(note.text, /year-to-date/)
  assert.doesNotMatch(note.text, /current-period/)
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
  // And the merged explanation actually made it into both renderers.
  assert.ok(md.some((t) => /shown in the GL detail, including/.test(t)))
})

// --- internal support metadata ----------------------------------------------

test('structured support metadata remains available internally', () => {
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [GL('General Ledger.pdf')] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  const s = note.support[0]
  assert.equal(s.fileName, 'General Ledger.pdf')
  assert.equal(s.classificationType, 'General Ledger (GL)')
  assert.equal(typeof s.confidence, 'number')
  assert.ok(Array.isArray(s.sourceRows))
  assert.equal(typeof s.thick, 'boolean')
})

// --- Period Scope interop ---------------------------------------------------

test('Period Scope selector still narrows an enriched two-period narrative', () => {
  const two = generateNarrative({
    fileId: 'base',
    fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [
      { period: 'current', comparisons: FLAGGED },
      { period: 'ytd', comparisons: FLAGGED }
    ]
  })
  const enriched = enrichNarrative(two, { supporting: [GL()] })
  assert.equal(enriched.periods.length, 2)
  const current = scopeNarrative(enriched, 'current')
  assert.equal(current.periods.length, 1)
  assert.equal(current.periods[0].period, 'current')
  // Enrichment survives the scope narrowing.
  const note = current.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  assert.match(note.text, /current-period/)
})

// --- normalize / code helpers ----------------------------------------------

test('normalizeName strips a leading code and punctuation', () => {
  assert.equal(normalizeName('5100 · Utility Expense Recovery'), 'utility expense recovery')
  assert.equal(normalizeName('Utility Expense Recovery'), 'utility expense recovery')
  assert.equal(accountCode('5100 Utility Expense Recovery'), '5100')
  assert.equal(accountCode('Utility Expense Recovery'), '')
})
