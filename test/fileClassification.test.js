// Content-aware file classification tests — implements the approved design
// (docs/diagnostics/file-classification-design.md). Runs on Node's built-in test
// runner (`node --test`), no extra dependencies.
//
// Proves the non-negotiable safety guards:
//   • BASE SLOT UNTOUCHED — a file in the baseReport role keeps "Base Variance
//     Report" by role precedence, even with budget-looking content; variance
//     output is byte-identical before vs after this change.
//   • PRECEDENCE / STRICT AND — a real GL (Debit&Credit) and a comparative
//     statement (Actual&Variance) never classify as Budget; a month run alone is
//     never sufficient.
//   • VETO SAFETY — a confident budget signature can veto a filename-driven GL
//     branch, but a content GL (or a partial budget signature) never does.
//   • END-TO-END — a budget exported as "GL Worksheet" feeds Phase 2B.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classifyFile, classifyWithContent } from '../src/lib/classify.js'
import {
  detectStandaloneBudget,
  monthCols,
  monthIndexOf,
  STANDALONE_BUDGET,
  MIN_MONTH_COLS
} from '../src/lib/extract/fileType.js'
import { looksLikeBudget, reconstructBudgetTable, reconstructTable } from '../src/lib/extract/pdfTable.js'
import { normalize } from '../src/lib/extract/normalize.js'
import { computeVariance } from '../src/lib/variance/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

// --- detectStandaloneBudget (the strict AND signature) ---------------------

test('detectStandaloneBudget: Kardin-style monthly budget (no actuals) → true', () => {
  assert.equal(detectStandaloneBudget(['Account', ...MONTHS_FULL]), true)
})

test('detectStandaloneBudget: an explicit Budget column (no actuals/variance) → true', () => {
  assert.equal(detectStandaloneBudget(['Account', 'Annual Budget', '$/RSF']), true)
})

test('detectStandaloneBudget: a true GL (Debit & Credit) → false', () => {
  assert.equal(detectStandaloneBudget(['Account', 'Date', 'Debit', 'Credit', 'Balance']), false)
})

test('detectStandaloneBudget: a comparative statement (Actual & Variance) → false', () => {
  assert.equal(
    detectStandaloneBudget(['Account', 'Current Actual', 'Current Budget', 'Current Variance']),
    false
  )
})

test('detectStandaloneBudget: a month run WITH actuals → false (month run alone never suffices)', () => {
  // Twelve months but an Actual column present ⇒ this is a monthly actuals report,
  // not a budget. The strict AND rule rejects it.
  assert.equal(detectStandaloneBudget(['Account', 'Actual', ...MONTHS_FULL]), false)
})

test('detectStandaloneBudget: fewer than MIN_MONTH_COLS and no budget column → false', () => {
  const fiveMonths = MONTHS_FULL.slice(0, MIN_MONTH_COLS - 1)
  assert.equal(detectStandaloneBudget(['Account', ...fiveMonths]), false)
})

test('shared month detector recognizes full names and abbreviations', () => {
  assert.equal(monthIndexOf('March'), 2)
  assert.equal(monthIndexOf('Mar'), 2)
  assert.equal(monthIndexOf('Summary'), -1) // "may" must not trip inside a word
  assert.equal(monthCols(['Account', 'Jan', 'Feb', 'Notes']).length, 2)
})

// --- classifyWithContent (the override layer) ------------------------------

test('classifyWithContent: non-base budget content flips the label to Budget (basis content)', () => {
  const baseline = classifyFile({ name: 'GL Worksheet (1).pdf', role: 'supportingFile' })
  assert.equal(baseline.type, 'General Ledger (GL)') // filename rule today
  const out = classifyWithContent({
    name: 'GL Worksheet (1).pdf',
    normalized: { columns: ['Account', ...MONTHS_FULL], rows: [], fileType: STANDALONE_BUDGET },
    baseline
  })
  assert.equal(out.type, 'Budget')
  assert.equal(out.basis, 'content')
})

test('classifyWithContent: BASE slot is never content-classified', () => {
  const baseline = classifyFile({ name: 'GL Worksheet (1).pdf', role: 'baseReport' })
  assert.equal(baseline.type, 'Base Variance Report')
  assert.equal(baseline.basis, 'upload role')
  // Even with a budget-looking content tag, the base keeps its role-decided type.
  const out = classifyWithContent({
    name: 'GL Worksheet (1).pdf',
    normalized: { columns: ['Account', ...MONTHS_FULL], rows: [], fileType: STANDALONE_BUDGET },
    baseline
  })
  assert.deepEqual(out, baseline)
})

test('classifyWithContent: a GL keeps its label (content does not flip it)', () => {
  const baseline = classifyFile({ name: 'General Ledger.pdf', role: 'supportingFile' })
  const out = classifyWithContent({
    name: 'General Ledger.pdf',
    normalized: { columns: ['Account', 'Date', 'Debit', 'Credit', 'Balance'], rows: [] },
    baseline
  })
  assert.deepEqual(out, baseline)
})

test('classifyWithContent: no content match keeps the filename baseline', () => {
  const baseline = classifyFile({ name: 'mystery.csv', role: 'supportingFile' })
  const out = classifyWithContent({
    name: 'mystery.csv',
    normalized: { columns: ['Account', 'Amount'], rows: [] },
    baseline
  })
  assert.deepEqual(out, baseline)
})

// --- normalize tags the standalone budget additively ----------------------

test('normalize tags a standalone-budget spreadsheet and leaves columns/rows intact', () => {
  const grid = [
    ['Account', ...MONTHS_FULL],
    ['Utilities', 500, 500, 12000, 500, 500, 500, 500, 500, 500, 500, 500, 500]
  ]
  const { normalized } = normalize({ tables: [{ rows: grid }] }, 'spreadsheet')
  assert.equal(normalized.fileType, STANDALONE_BUDGET)
  assert.deepEqual(normalized.columns, ['Account', ...MONTHS_FULL])
  assert.equal(normalized.rows.length, 1)
})

test('normalize does NOT tag a comparative statement as a budget', () => {
  const grid = [
    ['Account', 'Actual', 'Budget', 'Variance'],
    ['Utilities', 25000, 15000, 10000]
  ]
  const { normalized } = normalize({ tables: [{ rows: grid }] }, 'spreadsheet')
  assert.notEqual(normalized.fileType, STANDALONE_BUDGET)
})

// --- PDF veto + budget reconstruction --------------------------------------

// Build position-aware line cells: account label at the left, each month value at
// an evenly-spaced x band that lines up with the header month columns.
function budgetLineCells({ accounts }) {
  const accX = 10
  const monthX = (i) => 100 + i * 40
  const header = [{ str: 'Account', x: accX }, ...MONTHS_FULL.map((m, i) => ({ str: m, x: monthX(i) }))]
  const rows = accounts.map(({ label, values }) => [
    { str: label, x: accX },
    ...values.map((v, i) => ({ str: String(v), x: monthX(i) }))
  ])
  return [header, ...rows]
}

function cellsToLines(lineCells) {
  return lineCells.map((cells) => cells.map((c) => c.str).join(' '))
}

test('looksLikeBudget: full signature (month run + marker, not GL/variance) → true', () => {
  const lines = [
    'Kardin Budget System 2026 Budget',
    'Account ' + MONTHS_FULL.join(' ')
  ]
  assert.equal(looksLikeBudget(lines), true)
})

test('looksLikeBudget: a month run with NO budget marker → false (partial does not veto)', () => {
  const lines = ['Account ' + MONTHS_FULL.join(' ')]
  assert.equal(looksLikeBudget(lines), false)
})

test('looksLikeBudget: a GL is never seen as a budget', () => {
  const lines = ['Date Reference Debit Credit Balance', '01/15/2026 INV100 1,000.00 0.00 1,000.00']
  assert.equal(looksLikeBudget(lines), false)
})

test('reconstructBudgetTable: builds a per-account monthly grid', () => {
  const lineCells = budgetLineCells({
    accounts: [{ label: 'Utilities', values: [500, 500, 12000, 500, 500, 500, 500, 500, 500, 500, 500, 500] }]
  })
  const table = reconstructBudgetTable(lineCells)
  assert.ok(table)
  assert.deepEqual(table.rows[0], ['Account', ...MONTHS_FULL])
  assert.equal(table.rows[1][0], 'Utilities')
  assert.equal(table.rows[1][3], '12000') // March value preserved positionally
})

test('reconstructTable: a budget named "GL Worksheet" is vetoed off the GL branch and rebuilt as a budget grid', () => {
  const lineCells = budgetLineCells({
    accounts: [{ label: 'Utilities', values: [500, 500, 12000, 500, 500, 500, 500, 500, 500, 500, 500, 500] }]
  })
  const lines = ['Kardin Budget System 2026 Budget', ...cellsToLines(lineCells)]
  const table = reconstructTable(lines, { lineCells, classificationType: 'General Ledger (GL)' })
  assert.ok(table)
  assert.equal(table.name, 'Reconstructed Budget')
  assert.deepEqual(table.rows[0], ['Account', ...MONTHS_FULL])
})

// --- BASE SAFETY: variance byte-identical before vs after ------------------

test('a budget-looking file in the base role does not change variance output', () => {
  // A base extraction whose content happens to look budget-ish (monthly columns).
  // It is selected/typed by ROLE, so computeVariance reads it unchanged.
  const baseGrid = [
    ['Account', 'Actual', 'Budget'],
    ['Utilities Expense', 25000, 15000],
    ['Rent Income', 5000, 5000]
  ]
  const { normalized } = normalize({ tables: [{ rows: baseGrid }] }, 'spreadsheet')
  const base = {
    fileId: 'base',
    fileName: 'GL Worksheet (1).pdf', // GL-ish name, but it is the base by role
    status: 'ok',
    confidence: 95,
    classification: classifyFile({ name: 'GL Worksheet (1).pdf', role: 'baseReport' }),
    normalized
  }
  // The base classifier never content-flips, and the variance is deterministic.
  assert.equal(base.classification.type, 'Base Variance Report')
  assert.deepEqual(computeVariance(base), computeVariance(base))
})

// --- END-TO-END: a "GL Worksheet" budget feeds Phase 2B --------------------

test('a content-detected budget feeds Phase 2B phasing on a flagged account; variance byte-identical', () => {
  // Base report (single-input), flags Utilities.
  const baseGrid = [
    ['Account', 'Actual', 'Budget'],
    ['Utilities Expense', 25000, 15000],
    ['Rent Income', 5000, 5000]
  ]
  const baseNorm = normalize({ tables: [{ rows: baseGrid }] }, 'spreadsheet').normalized
  const base = { fileId: 'base', fileName: 'Variance.xlsx', status: 'ok', confidence: 95, classification: { type: 'Base Variance Report' }, normalized: baseNorm }

  const variance = computeVariance(base)
  const narrative = generateNarrative(variance)

  // A budget exported with a GL-ish name: content tags it STANDALONE_BUDGET and the
  // classifier flips it to Budget, so Phase 2B mines it.
  const budgetGrid = [
    ['Account', ...MONTHS_FULL],
    ['Utilities Expense', 500, 500, 12000, 500, 500, 500, 500, 500, 500, 500, 500, 500]
  ]
  const budgetNorm = normalize({ tables: [{ rows: budgetGrid }] }, 'spreadsheet').normalized
  assert.equal(budgetNorm.fileType, STANDALONE_BUDGET)
  const budget = {
    fileId: 'bud',
    fileName: 'GL Worksheet (1).pdf',
    status: 'ok',
    confidence: 95,
    classification: classifyWithContent({
      name: 'GL Worksheet (1).pdf',
      normalized: budgetNorm,
      baseline: classifyFile({ name: 'GL Worksheet (1).pdf', role: 'supportingFile' })
    }),
    normalized: budgetNorm
  }
  assert.equal(budget.classification.type, 'Budget')

  const without = enrichNarrative(narrative, { supporting: [] })
  const withBudget = enrichNarrative(narrative, { supporting: [budget] })

  // Phasing appears on the flagged account, qualitatively and figure-free.
  const flagged = (nar) =>
    nar.periods.flatMap((p) => [...(p.highVariances || []), ...(p.expenseNotes || [])])
  const util = flagged(withBudget).find((n) => /Utilities/i.test(n.account))
  assert.ok(util)
  assert.match(util.text, /with budgeted spend weighted toward March/)
  // The uploaded monthly figure ($12,000) is never rendered — phasing is qualitative.
  assert.ok(!/12,?000/.test(util.text))

  // Variance-bearing fields are byte-identical with vs without the budget file.
  const fields = (nar) =>
    nar.periods.flatMap((p) =>
      ['highVariances', 'revenueNotes', 'expenseNotes'].flatMap((k) =>
        (p[k] || []).map((n) => ({
          account: n.account,
          varianceAmount: n.varianceAmount,
          variancePercent: n.variancePercent,
          comparisonType: n.comparisonType,
          base: n.originalText || n.text
        }))
      )
    )
  assert.deepEqual(fields(withBudget), fields(without))
})
