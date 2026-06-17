// --- Consume prepared evidence tests — NQ-4B.1b ----------------------------
// The dormant NQ-4B.1a `preparedEvidence` metadata (netted Debit/Credit totals,
// balance excluded) now improves GL-backed commentary: a ledger whose amount
// columns were ambiguous for summarizeDetail renders a quantified sentence
// instead of the count-only fallback — while support metadata, single-amount
// wording, the two-sentence cap, the no-names rule, and the no-causality
// guarantee all hold. Runs on `node --test`, no deps.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { enrichNarrative } from '../src/lib/enrich/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'

// --- helpers ---------------------------------------------------------------

const ACCT = 'Utility Expense Recovery'

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

function supporting({ fileName = 'General Ledger.pdf', type = 'General Ledger (GL)', columns, rows }) {
  return { fileName, status: 'ok', classification: { type }, normalized: { columns, rows } }
}

// Variance 12700 − 5334 = 7366.
const FLAGGED = [
  rec({ account: ACCT, actual: 12700, budget: 5334, accountType: 'expense', category: 'unfavorable', sourceRows: [4] })
]

function noteFor(enriched) {
  return enriched.periods[0].highVariances.find((x) => x.account === ACCT)
}

function enrich(gl) {
  return noteFor(enrichNarrative(baseNarrative(FLAGGED), { supporting: [gl] }))
}

// Forbidden causal / implied-causal phrasings (mirrors enrich.test.js).
const FORBIDDEN = [
  /primarily due to/i, /\bdue to\b/i, /caused by/i, /driven by/i, /drove/i,
  /because of/i, /resulting from/i, /attributable to/i, /\bexplains\b/i,
  /supporting the variance/i
]
function assertNoCausal(text) {
  for (const re of FORBIDDEN) assert.doesNotMatch(text, re, `forbidden phrase ${re} in: ${text}`)
}

// Exactly two sentences: S1 (base variance) + S2 (GL evidence).
function sentenceCount(text) {
  return (String(text).match(/[.!?](?:\s|$)/g) || []).length
}

// --- Debit/Credit quantified ----------------------------------------------

test('Debit/Credit ledger renders a quantified netted total', () => {
  const note = enrich(supporting({
    columns: ['Account', 'Debit', 'Credit'],
    rows: [[ACCT, '4000', ''], [ACCT, '3366', '']]
  }))
  assert.equal(note.preparedEvidence.netTotal, 7366)
  assert.equal(note.preparedEvidence.amountReliable, true)
  assert.match(note.text, /The movement reflects approximately \$7,400 across 2 related utility transactions\.$/)
  assert.doesNotMatch(note.text, /Activity was spread across/)
})

// --- Debit/Credit/Balance quantified + balance excluded --------------------

test('Debit/Credit/Balance ledger quantifies the net and excludes the running balance', () => {
  // Balance values are deliberately NOT the cumulative sum, so if the balance
  // column leaked into the total the figure would be wildly different.
  const note = enrich(supporting({
    columns: ['Account', 'Debit', 'Credit', 'Balance'],
    rows: [[ACCT, '4000', '', '50000'], [ACCT, '3366', '', '53366']]
  }))
  assert.equal(note.preparedEvidence.balanceExcluded, true)
  assert.equal(note.preparedEvidence.netTotal, 7366)
  assert.deepEqual(note.preparedEvidence.glRows.map((r) => r.balance), [50000, 53366])
  // The rendered figure is the net (≈$7,400), never the balance.
  assert.match(note.text, /approximately \$7,400 across 2 related utility transactions\.$/)
  assert.doesNotMatch(note.text, /50,000|53,366|103,366|\$10[0-9],/)
})

// --- single-amount byte-identical ------------------------------------------

test('single-amount GL is byte-identical (reconciliation does not fire)', () => {
  // summarizeDetail already produces a reliable total here, so the NQ-4B.1b gate
  // is skipped and the wording matches the pre-4B.1b behaviour exactly.
  const note = enrich(supporting({
    columns: ['Account', 'Amount'],
    rows: [['5100 Utility Expense Recovery', '7366'], ['6000 Office Supplies', '120']]
  }))
  assert.equal(note.support[0].detail.total, 7366, 'single amount column → reliable total preserved')
  assert.equal(note.preparedEvidence.columnModel, 'single-amount')
  assert.equal(
    note.text.endsWith('The movement reflects a single transaction of approximately $7,400.'),
    true,
    note.text
  )
})

// --- unresolved remains generic --------------------------------------------

test('unresolved amount columns keep the generic count-only wording', () => {
  const note = enrich(supporting({
    columns: ['Account', 'Description'],
    rows: [[ACCT, 'PG&E'], [ACCT, 'City Water']]
  }))
  assert.equal(note.preparedEvidence.amountReliable, false)
  assert.match(note.text, /\. Activity was spread across 2 related transactions\.$/)
  assert.doesNotMatch(note.text, /approximately/)
})

test('a partial Debit/Credit ledger (a row with neither side) is not reconciled', () => {
  const note = enrich(supporting({
    columns: ['Account', 'Debit', 'Credit'],
    rows: [[ACCT, '4000', ''], [ACCT, '', '']]
  }))
  assert.equal(note.preparedEvidence.amountReliable, false)
  assert.doesNotMatch(note.text, /approximately/)
})

// --- support.detail.total unchanged (insulation invariant) -----------------

test('support metadata is never mutated by reconciliation', () => {
  const note = enrich(supporting({
    columns: ['Account', 'Debit', 'Credit'],
    rows: [[ACCT, '4000', ''], [ACCT, '3366', '']]
  }))
  // summarizeDetail's total stays null even though the text is now quantified.
  assert.equal(note.support[0].detail.total, null)
  assert.match(note.text, /approximately \$7,400/)
})

// --- no names, two-sentence cap, no causality ------------------------------

test('reconciled commentary surfaces no vendor / description / memo name', () => {
  const note = enrich(supporting({
    columns: ['Account', 'Vendor', 'Description', 'Debit', 'Credit'],
    rows: [[ACCT, 'PG&E', 'Electric', '4000', ''], [ACCT, 'City Water', 'Water', '3366', '']]
  }))
  assert.match(note.text, /approximately \$7,400/)
  assert.doesNotMatch(note.text, /PG&E|City Water|Electric|Water service|\bWater\b/)
})

test('reconciled notes stay within two sentences and carry no causal language', () => {
  for (const gl of [
    supporting({ columns: ['Account', 'Debit', 'Credit'], rows: [[ACCT, '4000', ''], [ACCT, '3366', '']] }),
    supporting({ columns: ['Account', 'Debit', 'Credit', 'Balance'], rows: [[ACCT, '4000', '', '50000'], [ACCT, '3366', '', '53366']] }),
    supporting({ columns: ['Account', 'Description', 'Debit', 'Credit'], rows: [[ACCT, 'PG&E', '4000', ''], [ACCT, 'City Water', '3400', '']] })
  ]) {
    const note = enrich(gl)
    assert.equal(sentenceCount(note.text), 2, `expected 2 sentences: ${note.text}`)
    assertNoCausal(note.text)
    assertNoCausal(narrativeToMarkdown(enrichNarrative(baseNarrative(FLAGGED), { supporting: [gl] })))
  }
})
