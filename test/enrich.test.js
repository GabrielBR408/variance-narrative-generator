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

test('GL thick reliable total renders as a standalone evidence sentence (no causation)', () => {
  const n = baseNarrative(FLAGGED)
  const enriched = enrichNarrative(n, { supporting: [GL()] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  assert.ok(note.enriched, 'note should be marked enriched')
  assert.equal(note.support.length, 1)
  assert.equal(note.support[0].fileName, 'General Ledger.pdf')
  assert.equal(note.support[0].thick, true, 'GL row with an Amount column is thick')
  // The variance sentence is preserved verbatim, then a SEPARATE GL evidence
  // sentence states context only — never a causal comma clause. Phase 19A: a
  // single matching GL transaction classifies as one-time (Category A).
  assert.match(
    note.text,
    /^Utility Expense Recovery exceeded budget by \$7,366 \(138\.1%\)\. The movement reflects a single transaction of approximately \$7,400\.$/
  )
  // No citation / file-name / debug language leaks into the owner text.
  assert.doesNotMatch(note.text, /Supporting file/)
  assert.doesNotMatch(note.text, /General Ledger\.pdf/)
})

test('NQ-1B: a non-headline expense line is enriched in Expense Notes, not duplicated', () => {
  // Three larger drivers fill the High Variances headline, so the matched
  // Utility line (variance $7,366) falls to Expense Notes — where the same GL
  // evidence must attach — and is NOT also repeated in High Variances.
  const n = baseNarrative([
    rec({ account: 'Big Driver A', actual: 60000, budget: 5000, accountType: 'expense', category: 'unfavorable', sourceRows: [1] }),
    rec({ account: 'Big Driver B', actual: 55000, budget: 5000, accountType: 'expense', category: 'unfavorable', sourceRows: [2] }),
    rec({ account: 'Big Driver C', actual: 50000, budget: 5000, accountType: 'expense', category: 'unfavorable', sourceRows: [3] }),
    rec({ account: 'Utility Expense Recovery', actual: 12700, budget: 5334, accountType: 'expense', category: 'unfavorable', sourceRows: [4] })
  ])
  const enriched = enrichNarrative(n, { supporting: [GL()] })
  const inExpense = enriched.periods[0].expenseNotes.find((x) => x.account === 'Utility Expense Recovery')
  assert.ok(inExpense && inExpense.support && inExpense.support.length === 1, 'evidence attaches in Expense Notes')
  assert.ok(
    !enriched.periods[0].highVariances.some((x) => x.account === 'Utility Expense Recovery'),
    'de-duplicated: the line is not also in High Variances'
  )
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

test('multiple matching files: support keeps stable file-name order, GL phrases the evidence', () => {
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
  // GL outranks budget, so the standalone GL evidence sentence is used (a single
  // matching transaction → one-time, Category A).
  assert.match(note.text, /\. The movement reflects a single transaction of approximately \$7,400\.$/)
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

// --- Phase 17 / 17.1: GL detail summaries (evidence-only wording) ----------

test('GL reliable total renders the evidence sentence; vendor stays in metadata only', () => {
  const gl = supporting({
    fileName: 'General Ledger.pdf',
    type: 'General Ledger (GL)',
    columns: ['Account', 'Vendor', 'Amount'],
    rows: [
      ['Utility Expense Recovery', 'PG&E', '4000'],
      ['Utility Expense Recovery', 'PG&E', '3000'],
      ['Office Supplies', 'Staples', '10']
    ]
  })
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [gl] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  // Raw totals + vendor remain in the structured metadata (for Excel/support).
  const detail = note.support[0].detail
  assert.equal(detail.count, 2)
  assert.equal(detail.total, 7000)
  assert.equal(detail.topVendor, 'PG&E')
  assert.equal(detail.topVendorCount, 2)
  // Phase 19B: the GL total ($7,000) is within the variance ($7,366, ratio
  // ≈ 0.95) and the Vendor column carries a clean, dominant vendor at a 0.9 name
  // match across 2 rows (≤ 3) — so the vendor IS rendered as context.
  assert.match(note.text, /\. The movement reflects approximately \$7,000 of related PG&E activity\.$/)
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
  assert.equal(detail.total, null, 'two amount columns are ambiguous → summarizeDetail omits the total')
  // NQ-4B.1b: summarizeDetail still omits the total (support metadata unchanged),
  // but the rendered text now uses the netted Debit/Credit total prepared in
  // NQ-4B.1a. Still no causal language, no "Detail shows".
  assert.match(note.text, /The movement reflects approximately \$7,400 across 2 related utility transactions\.$/)
  assert.doesNotMatch(note.text, /Activity was spread across|Detail shows/)
})

test('GL with descriptions and ambiguous columns nets to a quantified total without surfacing names', () => {
  // Two amount columns make summarizeDetail's total ambiguous, but the netted
  // Debit/Credit total quantifies the text. A description column is present, yet
  // the reconciled path stays purely quantitative — no vendor/description name.
  const gl = supporting({
    fileName: 'General Ledger.pdf',
    type: 'General Ledger (GL)',
    columns: ['Account', 'Description', 'Debit', 'Credit'],
    rows: [
      ['Utility Expense Recovery', 'PG&E', '4000', ''],
      ['Utility Expense Recovery', 'City Water', '3000', '']
    ]
  })
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [gl] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  assert.equal(note.support[0].detail.total, null, 'ambiguous amounts → summarizeDetail omits the total')
  // 4000 + 3000 = 7000 (≤ the $7,366 variance, so the figure renders), rounded.
  assert.match(note.text, /The movement reflects approximately \$7,000 across 2 related utility transactions\.$/)
  assert.doesNotMatch(note.text, /PG&E|City Water/)
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
  // Weak/name-only match → review-only language, never "supporting the variance".
  assert.match(note.text, /\. Account-level activity was available for review\.$/)
  assert.doesNotMatch(note.text, /supporting the variance|primarily due to|Detail shows/)
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
  // And the standalone GL evidence sentence actually made it into both renderers.
  assert.ok(md.some((t) => /The movement reflects a single transaction of approximately/.test(t)))
})

// --- Phase 19A: classified commentary renders end-to-end -------------------

// Build a one-account flagged narrative + a GL file of literal amounts, enrich,
// and return the high-variance note for that account.
function enrichedNote({ account, actual, budget, category = 'unfavorable', amounts }) {
  const n = baseNarrative([rec({ account, actual, budget, accountType: 'expense', category, sourceRows: [4] })])
  const gl = supporting({
    fileName: 'General Ledger.pdf',
    type: 'General Ledger (GL)',
    columns: ['Account', 'Amount'],
    rows: amounts.map((a) => [account, String(a)])
  })
  const enriched = enrichNarrative(n, { supporting: [gl] })
  return enriched.periods[0].highVariances.find((x) => x.account === account)
}

test('Category B: one transaction dominates a multi-transaction total', () => {
  const note = enrichedNote({ account: 'Repairs Expense', actual: 25000, budget: 5000, amounts: [18000, 1000, 1000] })
  assert.match(note.text, /\. The movement reflects approximately \$20,000 across 3 transactions, with the largest single item about \$18,000 of the total\.$/)
})

test('Category C: several evenly-spread recurring transactions', () => {
  // Total ($4,000) equals the variance, so the aligned render guard does not trip.
  const note = enrichedNote({ account: 'Landscaping Expense', actual: 9000, budget: 5000, amounts: [1000, 1000, 1000, 1000] })
  assert.match(note.text, /\. The movement reflects approximately \$4,000 across 4 recurring transactions\.$/)
})

test('Category D: activity against a zero budget', () => {
  const note = enrichedNote({ account: 'New Service Line', actual: 5000, budget: 0, amounts: [5000] })
  assert.match(note.text, /\. This activity occurred without a budget allocation and totaled approximately \$5,000\.$/)
  assert.doesNotMatch(note.text, /recommend|should consider/i)
})

test('Category E: a net credit reads as a credit, not new spend', () => {
  const note = enrichedNote({ account: 'Insurance Expense', actual: 1000, budget: 4000, category: 'favorable', amounts: [-3000] })
  assert.match(note.text, /\. The movement reflects a single credit of approximately \$3,000\.$/)
})

test('Category I: exactly two concentrated transactions', () => {
  // Total ($9,000) equals the variance, so the aligned render guard does not trip.
  const note = enrichedNote({ account: 'Marketing Expense', actual: 13000, budget: 4000, amounts: [6000, 3000] })
  assert.match(note.text, /\. The movement was concentrated in approximately \$9,000 across two related transactions\.$/)
})

// --- Phase 19B: contribution-aware commentary ------------------------------

// Enrich one account with explicit GL columns/rows and account semantics.
function enrichedWith({ account, actual, budget, accountType = 'expense', category = 'unfavorable', columns, rows }) {
  const n = baseNarrative([rec({ account, actual, budget, accountType, category, sourceRows: [4] })])
  const gl = supporting({ fileName: 'General Ledger.pdf', type: 'General Ledger (GL)', columns, rows })
  const enriched = enrichNarrative(n, { supporting: [gl] })
  return enriched.periods[0].highVariances.find((x) => x.account === account)
}

test('Contribution: disproportionate GL (ratio > 10) suppresses the dollar figure', () => {
  // $2,189 variance, $265,000 of GL activity — the headline failure case.
  const note = enrichedWith({
    account: 'Repairs Expense', actual: 7189, budget: 5000,
    columns: ['Account', 'Amount'], rows: [['Repairs Expense', '265000']]
  })
  assert.match(note.text, /\. Related activity was materially larger than the reported variance, indicating the variance reflects only part of the account movement\.$/)
  assert.doesNotMatch(note.text, /265|\$265,000/)
})

test('Contribution: offset-heavy GL never renders a transaction larger than the total', () => {
  // $7,186 variance, $10,700 net, a single $23,200 line offset by a credit.
  const note = enrichedWith({
    account: 'Fire Sprinkler Expense', actual: 12186, budget: 5000,
    columns: ['Account', 'Amount'], rows: [['Fire Sprinkler Expense', '23200'], ['Fire Sprinkler Expense', '-12500']]
  })
  assert.match(note.text, /\. Related activity of approximately \$10,700 includes offsetting entries\.$/)
  assert.doesNotMatch(note.text, /23,200|one of about/)
})

test('Contribution: partial GL is framed as only a portion of the movement', () => {
  const note = enrichedWith({
    account: 'Repairs Expense', actual: 45000, budget: 5000,
    columns: ['Account', 'Amount'], rows: [['Repairs Expense', '1800']]
  })
  assert.match(note.text, /\. Related activity totaled approximately \$1,800, accounting for a portion of the total movement\.$/)
})

test('Contribution: direction conflict (unfavorable expense, net credit) is flagged', () => {
  const note = enrichedWith({
    account: 'Repairs Expense', actual: 8000, budget: 5000,
    columns: ['Account', 'Amount'], rows: [['Repairs Expense', '-5000']]
  })
  assert.match(note.text, /\. Related activity reflects a net credit of approximately \$5,000, running opposite to the reported movement and worth a closer look\.$/)
})

test('Contribution: a clean, dominant vendor is rendered on an aligned line', () => {
  const note = enrichedWith({
    account: 'Utility-Building Water', actual: 3100, budget: 1000,
    columns: ['Account', 'Vendor', 'Amount'], rows: [['Utility-Building Water', 'City Water', '2100']]
  })
  assert.match(note.text, /\. The movement reflects approximately \$2,100 of related City Water activity\.$/)
})

test('Contribution: a clean short description is appended on an aligned line', () => {
  const note = enrichedWith({
    account: 'Repairs Expense', actual: 1500, budget: 1000,
    columns: ['Account', 'Description', 'Amount'], rows: [['Repairs Expense', 'HVAC repair', '500']]
  })
  assert.match(note.text, /\. The movement reflects a single transaction of approximately \$500 \(HVAC repair\)\.$/)
})

test('Contribution: a reference-like vendor is never rendered', () => {
  const note = enrichedWith({
    account: 'Repairs Expense', actual: 1600, budget: 1000,
    columns: ['Account', 'Vendor', 'Amount'], rows: [['Repairs Expense', 'AP 064697', '600']]
  })
  assert.doesNotMatch(note.text, /AP 064697|064697/)
})

test('Render guard: an aligned GL total larger than the variance suppresses the dollar', () => {
  // ratio 2.0 (still aligned), but the $2,000 total exceeds the $1,000 variance.
  const note = enrichedWith({
    account: 'Repairs Expense', actual: 6000, budget: 5000,
    columns: ['Account', 'Amount'], rows: [['Repairs Expense', '2000']]
  })
  assert.match(note.text, /\. Related activity exceeded the reported variance, suggesting offsetting entries or account-level timing also affected the result\.$/)
  assert.doesNotMatch(note.text, /\$2,000|Detail shows a single transaction/)
})

test('Render guard does NOT trip when the GL total is within the variance', () => {
  const note = enrichedWith({
    account: 'Repairs Expense', actual: 7000, budget: 5000,
    columns: ['Account', 'Amount'], rows: [['Repairs Expense', '1800']]
  })
  assert.match(note.text, /\. The movement reflects a single transaction of approximately \$1,800\.$/)
})

test('Revenue credit softening: a non-expense credit reads as related credit activity', () => {
  // An income-like line typed "unknown" reaches the credit category; it should
  // not read as a "single credit" of spend.
  const note = enrichedWith({
    account: 'Rental Inc-Parking', actual: 4000, budget: 5000,
    accountType: 'unknown', category: 'neutral',
    columns: ['Account', 'Amount'], rows: [['Rental Inc-Parking', '-1000']]
  })
  assert.match(note.text, /\. The movement reflects related credit activity of approximately \$1,000\.$/)
  assert.doesNotMatch(note.text, /single credit|net credits/)
})

test('Expense credit still reads as a credit / true-up (softening is non-expense only)', () => {
  const note = enrichedWith({
    account: 'Insurance Expense', actual: 1000, budget: 4000, category: 'favorable',
    columns: ['Account', 'Amount'], rows: [['Insurance Expense', '-3000']]
  })
  assert.match(note.text, /\. The movement reflects a single credit of approximately \$3,000\.$/)
})

// --- Phase 17.1: no causation / implied-causation language -----------------

const FORBIDDEN = [
  /primarily due to/i,
  /\bdue to\b/i,
  /caused by/i,
  /driven by/i,
  /supporting the variance/i,
  /\bexplains\b/i,
  /because of/i,
  /resulting from/i
]

function assertNoForbidden(text) {
  for (const re of FORBIDDEN) assert.doesNotMatch(text, re, `forbidden phrase ${re} in: ${text}`)
}

test('no rendered narrative contains causation or implied-causation phrases', () => {
  // Cover every evidence shape: reliable GL, ambiguous GL, descriptions-only GL,
  // thin GL, budget-only, prior, and other.
  const variants = [
    GL('General Ledger.pdf'),
    supporting({ fileName: 'gl2.pdf', type: 'General Ledger (GL)', columns: ['Account', 'Debit', 'Credit'], rows: [['Utility Expense Recovery', '4000', ''], ['Utility Expense Recovery', '3366', '']] }),
    supporting({ fileName: 'gl3.pdf', type: 'General Ledger (GL)', columns: ['Account', 'Description', 'Debit', 'Credit'], rows: [['Utility Expense Recovery', 'PG&E', '4000', ''], ['Utility Expense Recovery', 'City Water', '3400', '']] }),
    supporting({ fileName: 'gl4.pdf', type: 'General Ledger (GL)', columns: ['Account'], rows: [['Utility Expense Recovery']] }),
    supporting({ fileName: 'budget.xlsx', type: 'Budget', columns: ['Account', 'Budget'], rows: [['Utility Expense Recovery', '5334']] }),
    supporting({ fileName: 'prior.xlsx', type: 'Prior Period', columns: ['Account', 'Amount'], rows: [['Utility Expense Recovery', '5000']] }),
    supporting({ fileName: 'misc.pdf', type: 'Supporting Document', columns: ['Account', 'Amount'], rows: [['Utility Expense Recovery', '1']] })
  ]
  for (const ev of variants) {
    const md = narrativeToMarkdown(enrichNarrative(baseNarrative(FLAGGED), { supporting: [ev] }))
    assertNoForbidden(md)
  }
})

// --- NQ-1A: mechanical / extraction-style wording is gone ------------------

// The owner-facing enriched output must read as business explanation, never as a
// description of the evidence-extraction step. These phrases were the observed
// "evidence leakage" the rewrite removed; none may survive in any rendered note.
const BANNED_NQ1A = [
  /Detail shows/i,
  /Detail includes/i,
  /Detail reflects/i,
  /Detailed activity includes/i,
  /Detailed account activity/i,
  /Related activity appears/i,
  /Related transactions appear/i,
  /during the current period/i,
  /which is broader than this variance/i,
  /runs counter to the variance direction/i,
  /warrants review/i
]

test('NQ-1A: no enriched narrative contains mechanical/extraction-style wording', () => {
  // Exercise every contribution/shape branch across conservative AND detailed
  // modes, current AND year-to-date, then scan the full rendered Markdown.
  const cases = [
    enrichedNote({ account: 'Repairs Expense', actual: 25000, budget: 5000, amounts: [18000, 1000, 1000] }),     // B
    enrichedNote({ account: 'Landscaping Expense', actual: 9000, budget: 5000, amounts: [1000, 1000, 1000, 1000] }), // C
    enrichedNote({ account: 'New Service Line', actual: 5000, budget: 0, amounts: [5000] }),                       // D
    enrichedNote({ account: 'Insurance Expense', actual: 1000, budget: 4000, category: 'favorable', amounts: [-3000] }), // E
  ].map((n) => n.text)

  const renders = [
    narrativeToMarkdown(enrichNarrative(baseNarrative(FLAGGED), { supporting: [GL()] })),
    narrativeToMarkdown(enrichNarrative(baseNarrative(FLAGGED), { supporting: [GL()], mode: 'detailed' })),
    ...cases
  ]

  // Cover the contribution branches (partial / offset-heavy / disproportionate /
  // direction-conflict / aligned-vendor / exceeds-variance) and a thin match.
  for (const ev of [
    enrichedWith({ account: 'Repairs Expense', actual: 45000, budget: 5000, columns: ['Account', 'Amount'], rows: [['Repairs Expense', '1800']] }),
    enrichedWith({ account: 'Fire Sprinkler Expense', actual: 12186, budget: 5000, columns: ['Account', 'Amount'], rows: [['Fire Sprinkler Expense', '23200'], ['Fire Sprinkler Expense', '-12500']] }),
    enrichedWith({ account: 'Repairs Expense', actual: 7189, budget: 5000, columns: ['Account', 'Amount'], rows: [['Repairs Expense', '265000']] }),
    enrichedWith({ account: 'Repairs Expense', actual: 8000, budget: 5000, columns: ['Account', 'Amount'], rows: [['Repairs Expense', '-5000']] }),
    enrichedWith({ account: 'Repairs Expense', actual: 6000, budget: 5000, columns: ['Account', 'Amount'], rows: [['Repairs Expense', '2000']] })
  ]) renders.push(ev.text)

  for (const text of renders) {
    for (const re of BANNED_NQ1A) {
      assert.doesNotMatch(text, re, `banned NQ-1A phrase ${re} in: ${text}`)
    }
  }
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
  // Enrichment survives the scope narrowing. Current-period wording carries no
  // mechanical "during the current period" suffix (NQ-1A) and no YTD wording.
  const note = current.periods[0].highVariances.find((x) => x.account === 'Utility Expense Recovery')
  assert.match(note.text, /\. The movement reflects a single transaction of approximately \$7,400\.$/)
  assert.doesNotMatch(note.text, /year-to-date/)
})

// --- normalize / code helpers ----------------------------------------------

test('normalizeName strips a leading code and punctuation', () => {
  assert.equal(normalizeName('5100 · Utility Expense Recovery'), 'utility expense recovery')
  assert.equal(normalizeName('Utility Expense Recovery'), 'utility expense recovery')
  assert.equal(accountCode('5100 Utility Expense Recovery'), '5100')
  assert.equal(accountCode('Utility Expense Recovery'), '')
})
