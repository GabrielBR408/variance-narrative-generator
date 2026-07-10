// --- QA lib fixes — regression tests ---------------------------------------
// One test per defect found in the July 2026 deep QA pass, locking in the
// corrected behavior of the extraction/variance/narrative/enrich libraries.
// Each block names the defect it guards against.

import test from 'node:test'
import assert from 'node:assert/strict'

import { toNumber } from '../src/lib/extract/normalize.js'
import { displayAccountLabel } from '../src/lib/narrative/formatters.js'
import { displayAccount, approxMoney, polishVendor } from '../src/lib/enrich/templates.js'
import { classifyFile, extensionOf } from '../src/lib/classify.js'
import { messageNoCandidate, messageMultipleCandidates } from '../src/lib/variance/baseGate.js'
import { computeVariance } from '../src/lib/variance/index.js'
import { detectComparisonSets } from '../src/lib/variance/detectColumns.js'
import { rankContribution } from '../src/lib/enrich/contribution.js'
import { abbreviateDollarAmount } from '../src/lib/narrative/dollarAbbrev.js'
import { sanitizeExplanation } from '../src/lib/enrich/budgetContext.js'
import { generateNarrative } from '../src/lib/narrative/index.js'

// --- toNumber: accounting negatives with the $ OUTSIDE the parens ----------
// "$(1,234)" silently parsed as +1,234 (the paren test required the raw string
// to START with "(") — a lost credit that zeroed real variances.
test('toNumber: currency symbol outside accounting parens keeps the negative', () => {
  assert.equal(toNumber('$(1,234)'), -1234)
  assert.equal(toNumber('$ (1,234.50)'), -1234.5)
  assert.equal(toNumber('(1,234)%'), -1234)
  // Unchanged forms
  assert.equal(toNumber('($1,234)'), -1234)
  assert.equal(toNumber('(500.00)'), -500)
  assert.equal(toNumber('$1,234.56'), 1234.56)
})

// --- toNumber: scientific notation must not be mangled ----------------------
// The symbol strip deleted the "e" and concatenated mantissa and exponent
// digits: '1e12' → 112, '2.5E+11' → 2.511.
test('toNumber: scientific notation parses whole or not at all', () => {
  assert.equal(toNumber('1e12'), 1e12)
  assert.equal(toNumber('2.5E+11'), 2.5e11)
  assert.equal(toNumber('1.5e3'), 1500)
  assert.equal(toNumber('-1.5e3'), -1500)
})

// --- displayAccountLabel / displayAccount: codes are standalone tokens ------
// '401k Match' rendered as 'k Match'; '24-Hour Security' lost its '24'.
test('display labels: digits glued to letters are names, not account codes', () => {
  for (const fn of [displayAccountLabel, displayAccount]) {
    assert.equal(fn('401k Match'), '401k Match')
    assert.equal(fn('24-Hour Security'), '24-Hour Security')
    // Genuine codes still strip
    assert.equal(fn('54110 Real Estate Taxes'), 'Real Estate Taxes')
    assert.equal(fn('5010 · Utilities'), 'Utilities')
    assert.equal(fn('54110 - Real Estate Taxes'), 'Real Estate Taxes')
    assert.equal(fn('10-6300 Repairs'), 'Repairs')
    // Stripping-to-nothing falls back to the original
    assert.equal(fn('54110'), '54110')
  }
})

// --- extensionOf / classifyFile: explicit null name must not throw ----------
test('classifyFile tolerates a null file name', () => {
  assert.equal(extensionOf(null), '')
  assert.doesNotThrow(() => classifyFile({ name: null }))
})

// --- base gate messages: no doubled subject on an empty filename ------------
test('base gate messages read correctly with and without a filename', () => {
  assert.match(messageNoCandidate(''), /^The uploaded base file doesn't look/)
  assert.match(messageNoCandidate('report.xlsx'), /^The file "report\.xlsx" doesn't look/)
  assert.match(messageMultipleCandidates(''), /^The uploaded base file doesn't look/)
  assert.ok(!messageNoCandidate('').includes('The file The uploaded'))
})

// Helper: minimal normalized extraction for computeVariance.
function extractionOf(columns, rows) {
  return {
    fileId: 'f1',
    fileName: 'test.xlsx',
    status: 'ok',
    confidence: 95,
    classification: { type: 'Existing Variance Report' },
    normalized: { columns, rows }
  }
}

// --- rollup rows: category neutralized whether or not they triggered --------
// An untriggered 'TOTAL OPERATING EXPENSES' kept its Favorable label while a
// triggered 'TOTAL INCOME' was neutralized — inconsistent presentation.
test('every rollup row is neutral, triggered or not', () => {
  const result = computeVariance(
    extractionOf(
      ['Account', 'Actual', 'Budget'],
      [
        ['Rental Income', 50000, 45000],
        ['TOTAL INCOME', 50000, 45000], // triggered rollup
        ['Janitorial', 19000, 19800],
        ['TOTAL OPERATING EXPENSES', 19000, 19800], // NOT triggered (-$800, -4%)
        ['NOI', 31000, 25200]
      ]
    )
  )
  const byName = Object.fromEntries(result.comparisons.map((c) => [c.account, c]))
  assert.equal(byName['TOTAL INCOME'].category, 'neutral')
  assert.equal(byName['TOTAL OPERATING EXPENSES'].category, 'neutral')
  assert.equal(byName['NOI'].category, 'neutral')
  assert.equal(byName['TOTAL INCOME'].thresholdTriggered, false)
})

// --- zero-noise rows: engine clears the trigger so all counts agree ---------
// A $0.50 / 250% row was counted by summarize (preview 'Flagged: 2') but
// suppressed by the narrative ('1 variance…') — two surfaces, two answers.
test('sub-$1 percent-triggered rows are cleared at the engine level', () => {
  const result = computeVariance(
    extractionOf(
      ['Account', 'Actual', 'Budget'],
      [
        ['Rounding Adjustment', 0.7, 0.2], // +$0.50, +250%
        ['Janitorial', 3000, 2000] // +$1,000, +50%
      ]
    )
  )
  assert.equal(result.summary.highVarianceCount, 1)
  const narrative = generateNarrative(result)
  const exec = narrative.periods[0].executiveSummary
  const execText = Array.isArray(exec) ? exec.map((n) => n.text).join(' ') : String(exec)
  assert.match(execText, /1 variance /)
})

// --- duplicate bare value headers must not shift the period to YTD ----------
// ['Account','Actual','Actual','Budget']: the orphaned first block consumed
// the 'current' fallback slot, mislabeling the only real comparison 'ytd'.
test('an orphaned duplicate Actual header does not steal the current period', () => {
  const { sets } = detectComparisonSets(
    ['Account', 'Actual', 'Actual', 'Budget'],
    [['Rent', 100, 200, 150]]
  )
  const comparable = sets.filter((s) => s.columns.actual !== null && s.columns.budget !== null)
  assert.equal(comparable.length, 1)
  assert.equal(comparable[0].period, 'current')
})

// --- a text column headed 'Current …' must not claim the Actual slot --------
test('a mostly-text "Current Notes" column is not treated as Actual', () => {
  const rows = [
    ['Rent', 'On track', 4000],
    ['Janitorial', 'Vendor change', 2500],
    ['Utilities', 'Seasonal', 1800]
  ]
  const { sets } = detectComparisonSets(['Account', 'Current Notes', 'Budget'], rows)
  for (const s of sets) {
    assert.notEqual(s.columns.actual, 1, 'text column claimed as actual')
  }
  // A NUMERIC column under a bare 'Current' band header still claims the slot.
  const numeric = detectComparisonSets(
    ['Account', 'Current', 'Budget'],
    [
      ['Rent', 4100, 4000],
      ['Janitorial', 2400, 2500]
    ]
  )
  assert.equal(numeric.sets[0].columns.actual, 1)
})

// --- credit-sign convention: favorability flips, figures do not -------------
test('credit-convention statements flip revenue favorability only', () => {
  const result = computeVariance(
    extractionOf(
      ['Account', 'Actual', 'Budget'],
      [
        ['Rental Income', -29517.42, -37392.22], // $7,875 LESS income → unfavorable
        ['Parking Income', -5200, -4100], // $1,100 MORE income → favorable
        ['TOTAL INCOME', -34717.42, -41492.22]
      ]
    )
  )
  const byName = Object.fromEntries(result.comparisons.map((c) => [c.account, c]))
  assert.equal(byName['Rental Income'].category, 'unfavorable')
  assert.equal(byName['Parking Income'].category, 'favorable')
  // Figures stay exactly as computed from the source
  assert.equal(byName['Rental Income'].varianceAmount, -29517.42 - -37392.22)
  assert.equal(result.comparisonSets[0].creditConvention, true)
})

test('natural-sign statements never flip (contra lines included)', () => {
  const result = computeVariance(
    extractionOf(
      ['Account', 'Actual', 'Budget'],
      [
        ['Rental Income', 50000, 45000],
        ['Vacancy Loss', -5000, -2000], // contra line, negative both sides
        ['TOTAL INCOME', 45000, 43000] // subtotal positive → natural sign
      ]
    )
  )
  const byName = Object.fromEntries(result.comparisons.map((c) => [c.account, c]))
  assert.equal(byName['Rental Income'].category, 'favorable')
  assert.equal(result.comparisonSets[0].creditConvention, false)
})

// --- favorable expense with ordinary unsigned GL activity: no false conflict
// 'Repairs & Maintenance came in under budget … ran opposite to the reported
// movement, consistent with credits or reversals' — asserted credits that
// don't exist for plain under-spend.
test('favorable expense with positive unsigned GL net is not a direction conflict', () => {
  const ranked = rankContribution({
    varianceAmount: -1500, // under budget
    comparisonType: 'budget',
    accountType: 'expense',
    category: 'favorable',
    detail: { total: 1500, count: 3, maxTxn: 800, vendor: 'Otis Elevator', confidence: 90 }
  })
  assert.notEqual(ranked.contributionType, 'direction-conflict')
  // The unfavorable side still asserts a genuine conflict (credits while over budget)
  const conflict = rankContribution({
    varianceAmount: 1500,
    comparisonType: 'budget',
    accountType: 'expense',
    category: 'unfavorable',
    detail: { total: -1500, count: 2, maxTxn: 900, vendor: 'Otis Elevator', confidence: 90 }
  })
  assert.equal(conflict.contributionType, 'direction-conflict')
})

// --- abbreviateDollarAmount: boundary promotion + null contract -------------
test('dollar abbreviation promotes across $1,000 and honors the null contract', () => {
  assert.equal(abbreviateDollarAmount(999.95), '$1K')
  assert.equal(abbreviateDollarAmount(-999.99), '-$1K')
  assert.equal(abbreviateDollarAmount(999.9), '$999.9')
  assert.equal(abbreviateDollarAmount(null), null)
  assert.equal(abbreviateDollarAmount(undefined), null)
  assert.equal(abbreviateDollarAmount(''), null)
  assert.equal(abbreviateDollarAmount(0), '$0')
})

// --- approxMoney: a nonzero total never reads as 'approximately $0' ----------
test('approxMoney floors tiny nonzero totals at $1 instead of $0', () => {
  assert.equal(approxMoney(4), '$4')
  assert.equal(approxMoney(0.4), '$1')
  assert.equal(approxMoney(0), '$0')
  assert.equal(approxMoney(14), '$10')
  assert.equal(approxMoney(1234), '$1,200')
})

// --- polishVendor: deliberate mixed-case brand names survive -----------------
test('polishVendor preserves deliberate mixed-case vendor names', () => {
  assert.equal(polishVendor('CleanCo Services'), 'CleanCo Services')
  assert.equal(polishVendor('CLEANCO SERVICES'), 'Cleanco Services')
})

// --- sanitizeExplanation: no dangling 'due' after date stripping -------------
test('sanitizeExplanation drops a trailing "due" left by figure stripping', () => {
  const cleaned = sanitizeExplanation('Budget of $12,000 for roof repairs due 3/15/2026, PO 4482')
  assert.ok(!/\bdue$/i.test(cleaned), `still ends with "due": "${cleaned}"`)
})
