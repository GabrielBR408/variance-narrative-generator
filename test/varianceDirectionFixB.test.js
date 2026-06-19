// Fix B (revised) — Section-driven variance direction + reportStyle wiring.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Two confirmed bugs are locked down here:
//   (1) DIRECTION: favorable/unfavorable/neutral is arithmetic (variance sign +
//       income-statement side). The authoritative side comes from the line's
//       POSITION — which section subtotal it rolls into — NOT its account name.
//       Includes the corrected live regression: "Admin Fee - CY" rolls up into
//       TOTAL OTHER INCOME, so it is INCOME; under budget => UNFAVORABLE.
//       Direction is deterministic and never an LLM judgment.
//   (2) WIRING: the deterministic narrative honors the active Style panel's
//       reportStyle (Concise => conservative, Detailed => detailed), instead of
//       the orphaned commentaryDetail field that hardcoded 'detailed'.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { accountType, classify } from '../src/lib/variance/calculate.js'
import { rollupSide, assignSectionTypes } from '../src/lib/variance/sectionType.js'
import { computeVariance } from '../src/lib/variance/index.js'
import { commentaryModeFromStyle } from '../src/lib/enrich/commentaryMode.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { buildSystemPrompt } from '../server/llm.js'

// --- 1. Direction truth table (classify) — arithmetic only -----------------

test('classify: expense under budget favorable, over budget unfavorable', () => {
  assert.equal(classify('expense', -500), 'favorable')
  assert.equal(classify('expense', 500), 'unfavorable')
})

test('classify: revenue above budget favorable, below budget unfavorable', () => {
  assert.equal(classify('revenue', 500), 'favorable')
  assert.equal(classify('revenue', -500), 'unfavorable')
})

test('classify: zero / unknown / non-finite is neutral', () => {
  assert.equal(classify('expense', 0), 'neutral')
  assert.equal(classify('revenue', 0), 'neutral')
  assert.equal(classify('unknown', 500), 'neutral')
  assert.equal(classify('expense', null), 'neutral')
  assert.equal(classify('expense', NaN), 'neutral')
})

// --- 2. Section typing (rollupSide / assignSectionTypes) --------------------

test('rollupSide: section subtotals define the side; NET/grand totals do not', () => {
  assert.equal(rollupSide('TOTAL OTHER INCOME'), 'revenue')
  assert.equal(rollupSide('TOTAL REVENUE'), 'revenue')
  assert.equal(rollupSide('TOTAL OPERATING EXPENSES'), 'expense')
  assert.equal(rollupSide('Subtotal Cost of Sales'), 'expense')
  // NET / grand totals aggregate both sides → not a section definer.
  assert.equal(rollupSide('NET OPERATING INCOME'), null)
  assert.equal(rollupSide('NET INCOME'), null)
  // Detail lines and coded accounts are not subtotals.
  assert.equal(rollupSide('Admin Fee - CY'), null)
  assert.equal(rollupSide('54110 Real Estate Taxes'), null)
  // Leading asterisks/bullets (MRI-style) are tolerated.
  assert.equal(rollupSide('** TOTAL OTHER INCOME'), 'revenue')
  assert.equal(rollupSide('  Total Operating Expenses'), 'expense')
})

test('assignSectionTypes: a detail line takes the side of the subtotal it rolls into', () => {
  const rows = [
    ['OTHER INCOME', '', ''],
    ['Admin Fee - CY', '59104.66', '70000'],
    ['Interest', '96.98', '100'],
    ['TOTAL OTHER INCOME', '151256.93', '160100'],
    ['Repairs Expense', '60000', '40000'],
    ['TOTAL OPERATING EXPENSES', '68000', '50000']
  ]
  const byRow = assignSectionTypes(rows, 0)
  assert.equal(byRow[1], 'revenue') // Admin Fee rolls into TOTAL OTHER INCOME
  assert.equal(byRow[2], 'revenue') // Interest
  assert.equal(byRow[4], 'expense') // Repairs rolls into TOTAL OPERATING EXPENSES
})

// --- 3. End-to-end direction by SECTION through computeVariance -------------

const COLS = ['Account', 'Actual', 'Budget', 'Variance']

// A faithful comparative income statement: section headers (dropped during
// alignment), detail lines, and the section subtotals they roll into.
const STATEMENT_ROWS = [
  ['RENTAL REVENUE', '', '', ''],
  ['Commercial Rent', '95000', '100000', ''], // revenue, under budget
  ['TOTAL RENTAL REVENUE', '95000', '100000', ''],
  ['OTHER INCOME', '', '', ''],
  ['Parking', '92055.29', '90000', ''], // revenue, over budget
  ['Admin Fee - CY', '59104.66', '70000', ''], // revenue, under budget  <-- regression
  ['Insurance Reimbursement', '5000', '4000', ''], // expense-NAMED but income-SECTION
  ['Equal Income Line', '5000', '5000', ''], // zero variance
  ['TOTAL OTHER INCOME', '161160.95', '169100', ''],
  ['TOTAL REVENUE', '256160.95', '269100', ''],
  ['OPERATING EXPENSES', '', '', ''],
  ['Repairs Expense', '60000', '40000', ''], // expense, over budget
  ['Payroll Expense', '8000', '10000', ''], // expense, under budget
  ['TOTAL OPERATING EXPENSES', '68000', '50000', ''],
  ['NET OPERATING INCOME', '188160.95', '219100', '']
]

function comparisonsByAccount(rows) {
  const variance = computeVariance({
    fileId: 'f1', fileName: 'Comparative Income Statement.xlsx', status: 'ok',
    confidence: 90, classification: { type: 'variance-report' },
    normalized: { columns: COLS, rows, accounts: [], dates: [], values: [] }
  })
  const map = {}
  for (const c of variance.comparisons) map[c.account] = c
  return map
}

test('income-side direction is section-driven', () => {
  const m = comparisonsByAccount(STATEMENT_ROWS)
  assert.equal(m['Commercial Rent'].accountType, 'revenue')
  assert.equal(m['Commercial Rent'].category, 'unfavorable') // revenue under budget
  assert.equal(m['Parking'].accountType, 'revenue')
  assert.equal(m['Parking'].category, 'favorable') // revenue over budget
})

test('expense-side direction is section-driven', () => {
  const m = comparisonsByAccount(STATEMENT_ROWS)
  assert.equal(m['Repairs Expense'].accountType, 'expense')
  assert.equal(m['Repairs Expense'].category, 'unfavorable') // expense over budget
  assert.equal(m['Payroll Expense'].accountType, 'expense')
  assert.equal(m['Payroll Expense'].category, 'favorable') // expense under budget
})

test('section membership OVERRIDES the account name', () => {
  const m = comparisonsByAccount(STATEMENT_ROWS)
  // Name says expense ("Insurance …"), but it sits in OTHER INCOME → revenue.
  assert.equal(accountType('Insurance Reimbursement'), 'expense') // fallback would say expense
  assert.equal(m['Insurance Reimbursement'].accountType, 'revenue') // section wins
  assert.equal(m['Insurance Reimbursement'].category, 'favorable') // revenue over budget
})

test('zero / within-threshold variance is neutral', () => {
  const m = comparisonsByAccount(STATEMENT_ROWS)
  assert.equal(m['Equal Income Line'].category, 'neutral')
})

// --- 4. CORRECTED live regression: Admin Fee is INCOME ---------------------

test('REGRESSION: Admin Fee - CY (TOTAL OTHER INCOME, under budget) reads UNFAVORABLE', () => {
  const m = comparisonsByAccount(STATEMENT_ROWS)
  const fee = m['Admin Fee - CY']
  assert.equal(fee.accountType, 'revenue') // it rolls into TOTAL OTHER INCOME
  assert.equal(fee.varianceAmount < 0, true) // came in under budget
  assert.equal(fee.category, 'unfavorable') // income under budget = unfavorable
})

test('Admin Fee direction is deterministic — identical across repeated runs', () => {
  const first = comparisonsByAccount(STATEMENT_ROWS)['Admin Fee - CY'].category
  for (let i = 0; i < 25; i++) {
    assert.equal(comparisonsByAccount(STATEMENT_ROWS)['Admin Fee - CY'].category, first)
  }
  assert.equal(first, 'unfavorable')
})

// --- 5. Account-name heuristic is FALLBACK ONLY ----------------------------

test('accountType keyword heuristic is used only when no section is available', () => {
  // No subtotals → assignSectionTypes yields null → name fallback decides.
  const flat = [['Repairs Expense', '60000', '40000', '']]
  const m = comparisonsByAccount(flat)
  assert.equal(m['Repairs Expense'].accountType, 'expense') // via name fallback
  assert.equal(m['Repairs Expense'].category, 'unfavorable')
})

// --- 6. Wiring: reportStyle → commentaryMode (not hardcoded) ----------------

test('commentaryModeFromStyle reads the live reportStyle field', () => {
  assert.equal(commentaryModeFromStyle({ reportStyle: 'Detailed' }), 'detailed')
  assert.equal(commentaryModeFromStyle({ reportStyle: 'Concise' }), 'conservative')
  assert.notEqual(
    commentaryModeFromStyle({ reportStyle: 'Concise' }),
    commentaryModeFromStyle({ reportStyle: 'Detailed' })
  )
})

test('commentaryModeFromStyle ignores the orphaned commentaryDetail field', () => {
  assert.equal(commentaryModeFromStyle({ commentaryDetail: 'Conservative' }), 'detailed')
})

const GL_COLUMNS = ['Account', 'Date', 'Reference', 'Vendor', 'Description', 'Amount']

function narrativeTextForStyle(reportStyle) {
  const account = 'Repairs Expense'
  const narrative = generateNarrative({
    fileId: 'base', fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report', thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{
      period: 'current',
      comparisons: [{
        account, actual: 18000, budget: 10000, prior: null,
        varianceAmount: 8000, variancePercent: 80, comparisonType: 'budget',
        thresholdTriggered: true, category: 'unfavorable', accountType: 'expense',
        missingData: false, confidence: 90, sourceRows: [0]
      }]
    }]
  })
  const gl = {
    fileName: '4. General Ledger.pdf', status: 'ok', classification: { type: 'General Ledger (GL)' },
    normalized: {
      columns: GL_COLUMNS,
      rows: [[account, '01/10/2026', 'INV-1', 'Acme Roofing', 'Roof repair', '8000']]
    }
  }
  const mode = commentaryModeFromStyle({ reportStyle })
  const out = enrichNarrative(narrative, { supporting: [gl], mode })
  const note = out.periods[0].expenseNotes.find((x) => x.account === account) ||
    out.periods[0].highVariances.find((x) => x.account === account)
  return note.text
}

test('Concise vs Detailed report styles yield different deterministic commentary', () => {
  assert.notEqual(narrativeTextForStyle('Concise'), narrativeTextForStyle('Detailed'))
})

// --- 7. The LLM is barred from determining direction ------------------------

test('the LLM system prompt forbids favorable/unfavorable judgments', () => {
  const prompt = buildSystemPrompt({ reportStyle: 'Detailed' })
  assert.match(prompt, /favorable or unfavorable/i)
  assert.match(prompt, /that judgment is made elsewhere/i)
})
