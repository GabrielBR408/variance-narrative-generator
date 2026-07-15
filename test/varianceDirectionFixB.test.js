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

test('assignSectionTypes: an intermediate NET/GROSS roll-up never inherits the NEXT section', () => {
  // A mid-statement NET OPERATING INCOME followed by another expense section:
  // buffering it like a detail line assigned it the side of the subtotal BELOW
  // it ('expense'), so a favorable NOI beat read as unfavorable.
  const rows = [
    ['Commercial Rent', '95000', '100000'],
    ['TOTAL REVENUE', '95000', '100000'],
    ['Repairs Expense', '60000', '40000'],
    ['TOTAL OPERATING EXPENSES', '60000', '40000'],
    ['NET OPERATING INCOME', '35000', '60000'],
    ['Interest Expense', '5000', '4000'],
    ['TOTAL OTHER EXPENSES', '5000', '4000']
  ]
  const byRow = assignSectionTypes(rows, 0)
  assert.equal(byRow[4], null, 'the intermediate roll-up carries no section side')
  // The detail lines around it are untouched.
  assert.equal(byRow[2], 'expense')
  assert.equal(byRow[5], 'expense')
})

test('a favorable mid-statement NOI beat never reads unfavorable end-to-end', () => {
  const rows = [
    ['Commercial Rent', '120000', '100000', ''],
    ['TOTAL REVENUE', '120000', '100000', ''],
    ['Repairs Expense', '40000', '40000', ''],
    ['TOTAL OPERATING EXPENSES', '40000', '40000', ''],
    ['NET OPERATING INCOME', '80000', '60000', ''], // +20,000 beat
    ['Interest Expense', '5000', '4000', ''],
    ['TOTAL OTHER EXPENSES', '5000', '4000', '']
  ]
  const m = comparisonsByAccount(rows)
  const noi = m['NET OPERATING INCOME']
  // Null section → no income-statement side (favorability is section-driven, and
  // the account name is never consulted), so the type is 'unknown'.
  assert.equal(noi.accountType, 'unknown')
  // computeVariance neutralizes roll-up rows (isRollupLabel): a sum of lines
  // already compared is never a flagged line item. The regression this guards
  // is the INVERSION — a favorable NOI beat must never read 'unfavorable'.
  assert.notEqual(noi.category, 'unfavorable')
  assert.equal(noi.category, 'neutral')
  assert.equal(noi.thresholdTriggered, false)
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

test('section membership DRIVES direction; the account name never does', () => {
  const m = comparisonsByAccount(STATEMENT_ROWS)
  // The keyword classifier has been removed: the name-only helper is neutralized
  // and reads NO side from the text, even for an obviously expense-ish name.
  assert.equal(accountType('Insurance Reimbursement'), 'unknown')
  // "Insurance Reimbursement" sits in OTHER INCOME, so its section makes it
  // revenue — over budget => favorable. Direction comes purely from position.
  assert.equal(m['Insurance Reimbursement'].accountType, 'revenue')
  assert.equal(m['Insurance Reimbursement'].category, 'favorable')
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

// --- 5. There is NO account-name fallback — direction is section-only -------

test('a line with no resolvable section is neutral — the account name is never used', () => {
  // No subtotals → assignSectionTypes yields null → no income-statement side.
  // The old keyword classifier would have typed this 'expense' from the name;
  // that path is gone, so the line is 'unknown' → neutral (never a guessed
  // favorable/unfavorable). Direction must come from a section subtotal.
  const flat = [['Repairs Expense', '60000', '40000', '']]
  const m = comparisonsByAccount(flat)
  assert.equal(m['Repairs Expense'].accountType, 'unknown')
  assert.equal(m['Repairs Expense'].category, 'neutral')
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

// --- 8. Real-user regressions: section-driven direction + reconciliation -----
// Locks in the three field-reported misclassifications and the exec-summary
// count invariant. Every direction here comes from the section a line rolls
// into — never from keyword-matching the account name.

// A faithful commercial income statement exercising all three reported bugs:
//   • "Base Rent - NNN" beat budget but read Unfavorable (\brent\b matched an
//     expense keyword before the revenue check).
//   • "R&M - General Building" (+$16,200 / 191%, unbudgeted emergency repair)
//     read Neutral (the CRE abbreviation "R&M" matched no expense keyword).
//   • "Vacancy Loss" — a contra-revenue line that lost $22,550 MORE than budget
//     — read as "under budget / credit reversal" (good news) instead of the bad
//     news it is.
const REAL_STATEMENT = [
  ['RENTAL REVENUE', '', '', ''],
  ['Base Rent - NNN', '120000', '100000', ''], // revenue, +$20,000 over budget → favorable
  ['Vacancy Loss', '-45000', '-22450', ''], // contra-revenue stored negative; $22,550 MORE vacancy → unfavorable
  ['TOTAL REVENUE', '75000', '77550', ''],
  ['OPERATING EXPENSES', '', '', ''],
  ['R&M - General Building', '24700', '8500', ''], // expense, +$16,200 / +191% → unfavorable (flagged, not neutral)
  ['Payroll', '8000', '10000', ''], // expense, -$2,000 under budget → favorable
  ['TOTAL OPERATING EXPENSES', '32700', '18500', '']
]

test('revenue line beating budget reads FAVORABLE (Base Rent - NNN, not miscaught by \\brent\\b)', () => {
  const m = comparisonsByAccount(REAL_STATEMENT)
  const rent = m['Base Rent - NNN']
  assert.equal(rent.accountType, 'revenue') // rolls into TOTAL REVENUE
  assert.equal(rent.varianceAmount, 20000) // beat budget
  assert.equal(rent.category, 'favorable')
})

test('over-budget expense reads UNFAVORABLE and is FLAGGED, not Neutral (R&M abbreviation)', () => {
  const m = comparisonsByAccount(REAL_STATEMENT)
  const rm = m['R&M - General Building']
  assert.equal(rm.accountType, 'expense') // rolls into TOTAL OPERATING EXPENSES
  assert.equal(rm.varianceAmount, 16200) // +$16,200
  assert.ok(rm.variancePercent > 190 && rm.variancePercent < 192) // ~191%
  assert.equal(rm.category, 'unfavorable') // NOT 'neutral'
  assert.equal(rm.thresholdTriggered, true) // flagged
})

test('worse-than-budget contra-revenue reads UNFAVORABLE (Vacancy Loss, not a credit reversal)', () => {
  const m = comparisonsByAccount(REAL_STATEMENT)
  const vac = m['Vacancy Loss']
  assert.equal(vac.accountType, 'revenue') // contra-revenue sits in the revenue section
  assert.equal(vac.varianceAmount, -22550) // lost $22,550 MORE than budget
  assert.equal(vac.category, 'unfavorable') // bad news, never "under budget / credit reversal"
})

test('an under-budget expense still reads FAVORABLE (Payroll) — section-driven both ways', () => {
  const m = comparisonsByAccount(REAL_STATEMENT)
  const pay = m['Payroll']
  assert.equal(pay.accountType, 'expense')
  assert.equal(pay.category, 'favorable')
})

// A statement whose CAPITAL EXPENDITURES detail line rolls into no revenue/expense
// subtotal ("TOTAL CAPITAL EXPENDITURES" defines no side), so it is directionless
// (neutral) even though it crosses the threshold — exactly the capex/bottom-line
// case that used to be counted in the total but excluded from the fav/unfav split.
const RECON_STATEMENT = [
  ['REVENUE', '', '', ''],
  ['Base Rent', '120000', '100000', ''], // +$20,000 revenue → favorable
  ['TOTAL REVENUE', '120000', '100000', ''],
  ['OPERATING EXPENSES', '', '', ''],
  ['Repairs', '30000', '10000', ''], // +$20,000 expense → unfavorable
  ['TOTAL OPERATING EXPENSES', '30000', '10000', ''],
  ['NET OPERATING INCOME', '90000', '90000', ''],
  ['CAPITAL EXPENDITURES', '', '', ''],
  ['Roof Replacement', '50000', '10000', ''], // +$40,000, no side → neutral but triggered
  ['TOTAL CAPITAL EXPENDITURES', '50000', '10000', '']
]

test('exec-summary favorable + unfavorable always reconcile to the stated count', () => {
  const variance = computeVariance({
    fileId: 'r1', fileName: 'Comparative Income Statement.xlsx', status: 'ok',
    confidence: 90, classification: { type: 'variance-report' },
    normalized: { columns: COLS, rows: RECON_STATEMENT, accounts: [], dates: [], values: [] }
  })
  // The capex detail line is triggered but directionless (neutral) — the very
  // kind of line that broke reconciliation before.
  const roof = variance.comparisons.find((c) => c.account === 'Roof Replacement')
  assert.equal(roof.category, 'neutral')
  assert.equal(roof.thresholdTriggered, true)

  const period = generateNarrative(variance).periods[0]
  const text = period.executiveSummary[0].text
  const match = text.match(/(\d+) variances? totaling [^()]*\((\d+) unfavorable, (\d+) favorable\)/)
  assert.ok(match, `executive summary should state a count and split: "${text}"`)
  const count = Number(match[1])
  const unfavorable = Number(match[2])
  const favorable = Number(match[3])
  assert.equal(unfavorable + favorable, count, 'fav + unfav must equal the stated total count')
  // Two directional rows (Base Rent favorable, Repairs unfavorable); the neutral
  // capex line is excluded from the headline count and total.
  assert.equal(count, 2)
  assert.equal(favorable, 1)
  assert.equal(unfavorable, 1)

  // No data loss: the excluded capex line still appears in the full export table.
  assert.ok(period.allVariances.some((v) => v.account === 'Roof Replacement'))
})
