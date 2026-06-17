// --- Prepared evidence metadata tests — NQ-4B.1a --------------------------
// Pure-function coverage of prepareEvidence (debit/credit netting, balance
// exclusion, top-contributor ordering, source-row traceability) plus an
// integration check that attaching the metadata leaves owner-visible narrative
// text byte-identical. Runs on Node's built-in runner (`node --test`), no deps.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildEvidenceIndex,
  matchAccount,
  prepareEvidence,
  enrichNarrative,
  TOP_CONTRIBUTORS_MAX
} from '../src/lib/enrich/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'

// --- helpers ---------------------------------------------------------------

const ACCT = 'Utility Expense Recovery'

function supporting({ fileName = 'General Ledger.pdf', type = 'General Ledger (GL)', columns, rows }) {
  return { fileName, status: 'ok', classification: { type }, normalized: { columns, rows } }
}

// Build the primary citation for ACCT from one supporting GL file, then prepare.
function prepare({ columns, rows, account = ACCT }) {
  const index = buildEvidenceIndex([supporting({ columns, rows })])
  const [citation] = matchAccount(account, index)
  return prepareEvidence({ note: { account }, citation })
}

// A flagged base note (variance 12700 − 5334 = 7366) for the integration test.
function rec({ account, actual, budget, accountType, category, sourceRows }) {
  const varianceAmount = actual - budget
  return {
    account,
    actual,
    budget,
    prior: null,
    varianceAmount,
    variancePercent: (varianceAmount / Math.abs(budget)) * 100,
    comparisonType: 'budget',
    thresholdTriggered: true,
    category,
    accountType,
    missingData: false,
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

const FLAGGED = [
  rec({ account: ACCT, actual: 12700, budget: 5334, accountType: 'expense', category: 'unfavorable', sourceRows: [4] })
]

// --- debit-only ------------------------------------------------------------

test('debit-only rows net to positive amounts', () => {
  const pe = prepare({
    columns: ['Account', 'Debit'],
    rows: [[ACCT, '4000'], [ACCT, '3366']]
  })
  assert.equal(pe.columnModel, 'debit-credit')
  assert.equal(pe.balanceExcluded, false)
  assert.equal(pe.transactionCount, 2)
  assert.equal(pe.netTotal, 7366)
  assert.equal(pe.maxTxn, 4000)
  assert.equal(pe.amountReliable, true)
  assert.deepEqual(pe.glRows.map((r) => r.netAmount), [4000, 3366])
})

// --- credit-only -----------------------------------------------------------

test('credit-only rows net to negative amounts (credit is negative)', () => {
  const pe = prepare({
    columns: ['Account', 'Credit'],
    rows: [[ACCT, '4000'], [ACCT, '1000']]
  })
  assert.equal(pe.columnModel, 'debit-credit')
  assert.equal(pe.netTotal, -5000)
  assert.equal(pe.maxTxn, 4000)
  assert.equal(pe.amountReliable, true)
  assert.deepEqual(pe.glRows.map((r) => r.netAmount), [-4000, -1000])
})

// --- mixed debit/credit ----------------------------------------------------

test('mixed debit/credit rows net as debit − credit', () => {
  const pe = prepare({
    columns: ['Account', 'Debit', 'Credit'],
    rows: [[ACCT, '4000', ''], [ACCT, '', '1500'], [ACCT, '2000', '']]
  })
  assert.equal(pe.columnModel, 'debit-credit')
  assert.equal(pe.transactionCount, 3)
  assert.equal(pe.netTotal, 4500) // 4000 − 1500 + 2000
  assert.equal(pe.maxTxn, 4000)
  assert.equal(pe.amountReliable, true)
  assert.deepEqual(pe.glRows.map((r) => r.netAmount), [4000, -1500, 2000])
})

// --- balance excluded ------------------------------------------------------

test('Debit/Credit/Balance rows exclude the running balance from totals', () => {
  const pe = prepare({
    columns: ['Account', 'Debit', 'Credit', 'Balance'],
    rows: [[ACCT, '4000', '', '4000'], [ACCT, '3366', '', '7366']]
  })
  assert.equal(pe.columnModel, 'debit-credit')
  assert.equal(pe.balanceExcluded, true)
  // Balance is captured per row for traceability …
  assert.deepEqual(pe.glRows.map((r) => r.balance), [4000, 7366])
  // … but never summed into the transaction total.
  assert.equal(pe.netTotal, 7366) // 4000 + 3366, NOT the 7366 closing balance only
  assert.deepEqual(pe.glRows.map((r) => r.netAmount), [4000, 3366])
  assert.equal(pe.maxTxn, 4000)
  assert.equal(pe.amountReliable, true)
})

test('a balance-only column is excluded and leaves the model unresolved', () => {
  const pe = prepare({
    columns: ['Account', 'Balance'],
    rows: [[ACCT, '4000'], [ACCT, '7366']]
  })
  assert.equal(pe.columnModel, 'unresolved')
  assert.equal(pe.balanceExcluded, true)
  assert.equal(pe.netTotal, null)
  assert.equal(pe.transactionCount, 0)
  assert.equal(pe.amountReliable, false)
})

// --- single amount (no balance) --------------------------------------------

test('a lone amount column with no balance nets directly', () => {
  const pe = prepare({
    columns: ['Account', 'Amount'],
    rows: [[ACCT, '7366'], [ACCT, '120']]
  })
  assert.equal(pe.columnModel, 'single-amount')
  assert.equal(pe.balanceExcluded, false)
  assert.equal(pe.netTotal, 7486)
  assert.equal(pe.maxTxn, 7366)
  assert.equal(pe.amountReliable, true)
})

// --- unresolved amount columns ---------------------------------------------

test('rows with no parseable transaction amount are unresolved', () => {
  const pe = prepare({
    columns: ['Account', 'Description'],
    rows: [[ACCT, 'PG&E'], [ACCT, 'City Water']]
  })
  assert.equal(pe.columnModel, 'unresolved')
  assert.equal(pe.netTotal, null)
  assert.equal(pe.maxTxn, null)
  assert.equal(pe.transactionCount, 0)
  assert.equal(pe.amountReliable, false)
  assert.deepEqual(pe.topContributors, [])
})

// --- top contributor ordering ----------------------------------------------

test('top contributors are ordered by absolute net amount with safe cues', () => {
  const pe = prepare({
    columns: ['Account', 'Vendor', 'Debit'],
    rows: [
      [ACCT, 'City Water', '400'],
      [ACCT, 'PG&E', '4000'],
      [ACCT, 'Garbage Co', '1200']
    ]
  })
  assert.deepEqual(pe.topContributors.map((t) => t.netAmount), [4000, 1200, 400])
  assert.equal(pe.topContributors[0].vendor, 'PG&E')
  assert.equal(pe.topContributors[0].sourceRow, 1)
  assert.ok(pe.topContributors.length <= TOP_CONTRIBUTORS_MAX)
})

test('top contributor ties break by source row (deterministic)', () => {
  const pe = prepare({
    columns: ['Account', 'Debit'],
    rows: [[ACCT, '500'], [ACCT, '500'], [ACCT, '500']]
  })
  assert.deepEqual(pe.topContributors.map((t) => t.sourceRow), [0, 1, 2])
})

test('top contributors are capped at TOP_CONTRIBUTORS_MAX', () => {
  const pe = prepare({
    columns: ['Account', 'Debit'],
    rows: [[ACCT, '100'], [ACCT, '200'], [ACCT, '300'], [ACCT, '400'], [ACCT, '500']]
  })
  assert.equal(pe.topContributors.length, TOP_CONTRIBUTORS_MAX)
  assert.deepEqual(pe.topContributors.map((t) => t.netAmount), [500, 400, 300])
})

// --- source row traceability -----------------------------------------------

test('every prepared row is traceable to its source row index', () => {
  const pe = prepare({
    columns: ['Account', 'Debit'],
    rows: [[ACCT, '4000'], [ACCT, '3366'], [ACCT, '120']]
  })
  assert.deepEqual(pe.glRows.map((r) => r.sourceRow), [0, 1, 2])
})

// --- empty / missing citation ----------------------------------------------

test('an empty citation prepares an honest empty shape', () => {
  const pe = prepareEvidence({ note: { account: ACCT }, citation: {} })
  assert.deepEqual(pe.glRows, [])
  assert.equal(pe.columnModel, 'unresolved')
  assert.equal(pe.netTotal, null)
  assert.equal(pe.transactionCount, 0)
  assert.equal(pe.amountReliable, false)
  assert.equal(pe.balanceExcluded, false)
  assert.deepEqual(pe.topContributors, [])
})

// --- integration: byte-identical owner output ------------------------------

test('preparedEvidence attaches to a GL-enriched note without changing owner text', () => {
  const gl = supporting({
    fileName: 'General Ledger.pdf',
    columns: ['Account', 'Debit', 'Credit'],
    rows: [[ACCT, '4000', ''], [ACCT, '3366', '']]
  })
  const base = baseNarrative(FLAGGED)
  const before = narrativeToMarkdown(base)
  const enriched = enrichNarrative(base, { supporting: [gl] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === ACCT)

  // Metadata is present and correct (netted, reliable) …
  assert.ok(note.preparedEvidence, 'preparedEvidence attached to GL-enriched note')
  assert.equal(note.preparedEvidence.netTotal, 7366)
  assert.equal(note.preparedEvidence.amountReliable, true)
  assert.equal(note.preparedEvidence.columnModel, 'debit-credit')

  // … the existing summarized total is still null (summarizeDetail unchanged) …
  assert.equal(note.support[0].detail.total, null)

  // … and the OWNER text is unchanged: it still uses the count-only wording and
  // never renders the new netted aggregate (no GL "approximately" sentence).
  assert.match(note.text, /Activity was spread across 2 related transactions\.$/)
  assert.doesNotMatch(note.text, /approximately|Detail shows/)

  // The rendered Markdown gains nothing owner-visible beyond the base note text.
  const after = narrativeToMarkdown(enriched)
  assert.equal(after.includes('Activity was spread across 2 related transactions'), true)
  // The base figure $7,366 is the variance itself; the GL aggregate is NOT
  // separately rendered, so "approximately" never appears.
  assert.doesNotMatch(after, /approximately/)
  // Sanity: the base-only render did not already contain that GL clause.
  assert.doesNotMatch(before, /spread across 2 related transactions/)
})

test('a non-GL primary match carries no preparedEvidence', () => {
  const budget = supporting({
    fileName: 'Annual Budget.xlsx',
    type: 'Budget',
    columns: ['Account', 'Budget'],
    rows: [[ACCT, '5334']]
  })
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [budget] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === ACCT)
  assert.equal(note.preparedEvidence, undefined)
})
