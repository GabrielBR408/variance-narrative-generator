// Threshold logic tests — Phase 12 (Threshold Logic Audit + Output Polish).
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Locks in the intended rule across every layer that depends on it:
//   A variance triggers when it crosses EITHER threshold —
//     |dollar variance| >= dollar threshold  OR  |percent variance| >= percent
//   Equality triggers. Comparison is on absolute values. Favorable/unfavorable
//   direction is classified independently of whether a row triggers.
//
// Coverage: the pure isTriggered predicate, the end-to-end variance engine
// (computeVariance over a Current/YTD fixture exercising dollar-only,
// percent-only, both, neither, and exact-threshold cases), and that the
// Markdown + DOCX exports reflect exactly the corrected triggered set.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isTriggered, DEFAULT_THRESHOLDS } from '../src/lib/variance/thresholds.js'
import { calculate } from '../src/lib/variance/calculate.js'
import { computeVariance } from '../src/lib/variance/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'
import { narrativeToDocxBlocks } from '../src/lib/export/docx.js'

const THR = { amount: 1000, percent: 10 }

// --- isTriggered: the OR predicate ----------------------------------------

test('default thresholds are $1,000 OR 10%', () => {
  assert.equal(DEFAULT_THRESHOLDS.amount, 1000)
  assert.equal(DEFAULT_THRESHOLDS.percent, 10)
})

test('amount threshold only → triggers (dollar over, percent under)', () => {
  // +$2,000 movement, but only 4% — dollar alone must flag it.
  assert.equal(isTriggered(2000, 4, THR), true)
})

test('percent threshold only → triggers (percent over, dollar under)', () => {
  // +$100 movement, but 20% — percent alone must flag it.
  assert.equal(isTriggered(100, 20, THR), true)
})

test('both thresholds crossed → triggers', () => {
  assert.equal(isTriggered(5000, 50, THR), true)
})

test('neither threshold crossed → does not trigger', () => {
  // +$500 and +1%: below both.
  assert.equal(isTriggered(500, 1, THR), false)
})

test('exact dollar threshold → triggers (>= is inclusive)', () => {
  assert.equal(isTriggered(1000, 2, THR), true)
})

test('exact percent threshold → triggers (>= is inclusive)', () => {
  assert.equal(isTriggered(50, 10, THR), true)
})

test('triggering is on absolute values — favorable (+) and unfavorable (-) alike', () => {
  // Same magnitude, opposite signs: both must trigger identically.
  assert.equal(isTriggered(1500, 3, THR), true) // favorable revenue / unfavorable expense
  assert.equal(isTriggered(-1500, -3, THR), true)
  assert.equal(isTriggered(-100, -20, THR), true) // percent side, negative
})

test('missing / non-finite inputs never trigger', () => {
  assert.equal(isTriggered(null, null, THR), false)
  assert.equal(isTriggered(null, 50, THR), true) // percent alone still counts
  assert.equal(isTriggered(5000, null, THR), true) // amount alone still counts
  assert.equal(isTriggered(NaN, NaN, THR), false)
  assert.equal(isTriggered(undefined, undefined, THR), false)
})

// --- direction is classified independently of triggering -------------------

test('favorable and unfavorable rows trigger the same; only category differs', () => {
  const aligned = [
    { account: 'Service Revenue', actual: 12000, budget: 10000, prior: null, sourceRows: [1] }, // rev +2000 favorable
    { account: 'Repairs Expense', actual: 12000, budget: 10000, prior: null, sourceRows: [2] } // exp +2000 unfavorable
  ]
  const [rev, exp] = calculate(aligned, THR, 100)
  assert.equal(rev.thresholdTriggered, true)
  assert.equal(exp.thresholdTriggered, true)
  assert.equal(rev.category, 'favorable')
  assert.equal(exp.category, 'unfavorable')
})

// --- end-to-end engine fixture: every case, Current + YTD ------------------

// Columns laid out Current then YTD so both periods are exercised.
const COLUMNS = ['Account', 'Current Actual', 'Current Budget', 'YTD Actual', 'YTD Budget']

// Each row targets one trigger case under the default $1,000 / 10% rule.
// Current and YTD carry the same figures so both periods narrate identically.
const ROWS = [
  ['Service Revenue', '52000', '50000', '52000', '50000'], // +2000 / +4%  → dollar-only (favorable)
  ['Membership Income', '600', '500', '600', '500'], // +100 / +20% → percent-only (favorable)
  ['Repairs Expense', '3000', '1000', '3000', '1000'], // +2000 / +200% → both (unfavorable)
  ['Office Supplies Expense', '50500', '50000', '50500', '50000'], // +500 / +1% → neither
  ['Insurance Expense', '51000', '50000', '51000', '50000'], // +1000 / +2% → exact dollar (unfavorable)
  ['Consulting Income', '550', '500', '550', '500'] // +50 / +10% → exact percent (favorable)
]

function fixtureExtraction() {
  return {
    fileId: 'f-thr',
    fileName: 'thresholds.csv',
    status: 'ok',
    confidence: 90,
    classification: { type: 'variance-report' },
    normalized: { columns: COLUMNS, rows: ROWS, accounts: [], dates: [], values: [] }
  }
}

const TRIGGERED = ['Service Revenue', 'Membership Income', 'Repairs Expense', 'Insurance Expense', 'Consulting Income']
const NOT_TRIGGERED = 'Office Supplies Expense'

function triggeredAccountsFor(period) {
  const result = computeVariance(fixtureExtraction(), DEFAULT_THRESHOLDS)
  const set = result.comparisonSets.find((s) => s.period === period)
  return set.comparisons.filter((c) => c.thresholdTriggered).map((c) => c.account).sort()
}

test('engine flags exactly the dollar/percent/both/exact rows and skips the neither row (Current)', () => {
  const flagged = triggeredAccountsFor('current')
  assert.deepEqual(flagged, [...TRIGGERED].sort())
  assert.ok(!flagged.includes(NOT_TRIGGERED), 'the sub-threshold row must not be flagged')
})

test('Current/YTD behavior remains correct — both periods flag the same rows', () => {
  const result = computeVariance(fixtureExtraction(), DEFAULT_THRESHOLDS)
  assert.deepEqual(result.comparisonSets.map((s) => s.period), ['current', 'ytd'])
  assert.deepEqual(triggeredAccountsFor('current'), triggeredAccountsFor('ytd'))
})

test('engine preserves favorable/unfavorable on the triggered rows', () => {
  const result = computeVariance(fixtureExtraction(), DEFAULT_THRESHOLDS)
  const current = result.comparisonSets.find((s) => s.period === 'current')
  const byName = Object.fromEntries(current.comparisons.map((c) => [c.account, c]))
  assert.equal(byName['Service Revenue'].category, 'favorable')
  assert.equal(byName['Consulting Income'].category, 'favorable')
  assert.equal(byName['Repairs Expense'].category, 'unfavorable')
  assert.equal(byName['Insurance Expense'].category, 'unfavorable')
})

// --- exports reflect the corrected triggered set ---------------------------

function fixtureNarrative() {
  return generateNarrative(computeVariance(fixtureExtraction(), DEFAULT_THRESHOLDS))
}

test('Markdown export narrates every triggered row and omits the sub-threshold row', () => {
  const md = narrativeToMarkdown(fixtureNarrative())
  for (const account of TRIGGERED) {
    assert.ok(md.includes(account), `Markdown missing triggered row: ${account}`)
  }
  assert.ok(!md.includes(NOT_TRIGGERED), 'Markdown must not narrate the sub-threshold row')
  // Threshold wording is unambiguous OR.
  assert.match(md, /\$1,000 or 10%/)
})

test('DOCX export narrates every triggered row and omits the sub-threshold row', () => {
  const blocks = narrativeToDocxBlocks(fixtureNarrative())
  const text = blocks.map((b) => b.text).join('\n')
  for (const account of TRIGGERED) {
    assert.ok(text.includes(account), `DOCX missing triggered row: ${account}`)
  }
  assert.ok(!text.includes(NOT_TRIGGERED), 'DOCX must not narrate the sub-threshold row')
  // Both Current and YTD periods present.
  const periods = blocks.filter((b) => b.kind === 'period').map((b) => b.text)
  assert.deepEqual(periods, ['Current', 'YTD'])
})
