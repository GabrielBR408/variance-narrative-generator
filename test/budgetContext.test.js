// Uploaded-budget supplemental context tests — Phase 2B.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Proves the guardrails of the 2B fix:
//   • A separately uploaded budget file can add SUPPLEMENTAL context (a per-GL
//     explanation and/or monthly phasing) to the narrative of an account the BASE
//     report already flagged.
//   • Any budget FIGURE in the uploaded file is NEVER rendered — currency is
//     stripped from explanations and phasing is qualitative. The base report's
//     figures (carried on the original variance sentence) are preserved exactly.
//   • Causal budget prose is never surfaced.
//   • No uploaded budget / no match / no extra detail → behavior is unchanged.
//   • Variance numbers, direction, and thresholds are untouched by the budget file.
//   • The Abbreviate setting is respected (and the figure-free clause is inert).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeVariance } from '../src/lib/variance/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { applyDollarAbbreviation } from '../src/lib/narrative/dollarAbbrev.js'
import { BUDGET_SUMMARY } from '../src/lib/extract/fileType.js'
import {
  enrichNarrative,
  buildBudgetContextIndex,
  matchBudgetContext,
  sanitizeExplanation,
  derivePhasing,
  budgetContextClause
} from '../src/lib/enrich/index.js'

// --- helpers ---------------------------------------------------------------

function budgetFile({ columns, rows, classificationType = 'Budget', fileType, fileName = 'Budget.xlsx' }) {
  const normalized = { rows, columns, accounts: [], dates: [], values: [] }
  if (fileType) normalized.fileType = fileType
  return {
    fileId: 'bud',
    fileName,
    status: 'ok',
    confidence: 95,
    classification: { type: classificationType },
    normalized
  }
}

// A flagged base-report note. `text` carries the authoritative base figure
// ($10,000) — the only dollar amount the narrative may state.
function baseNote(overrides = {}) {
  return {
    account: 'Utilities',
    text: 'Utilities were $10,000 over budget (25%).',
    varianceAmount: 10000,
    variancePercent: 25,
    comparisonType: 'budget',
    accountType: 'expense',
    ...overrides
  }
}

function narrativeWith(note) {
  return {
    fileId: 'x',
    fileName: 'base',
    classification: {},
    thresholds: {},
    periods: [
      {
        period: 'current',
        periodLabel: 'Current',
        executiveSummary: '',
        highVariances: [note],
        missingData: [],
        revenueNotes: [],
        expenseNotes: [],
        sourceRows: []
      }
    ]
  }
}

function flagged(out) {
  return out.periods[0].highVariances[0]
}

// Count of distinct "$<number>" tokens in a string.
function dollarTokens(s) {
  return String(s).match(/\$\s?\d[\d,]*(?:\.\d+)?/g) || []
}

// --- sanitizeExplanation ---------------------------------------------------

test('sanitizeExplanation keeps qualitative text and strips leading filler', () => {
  assert.equal(
    sanitizeExplanation('Quarterly HVAC servicing and filter replacement'),
    'quarterly HVAC servicing and filter replacement'
  )
})

test('sanitizeExplanation removes currency figures entirely', () => {
  const out = sanitizeExplanation('Budget of $50,000 for roof replacement')
  assert.equal(out, 'roof replacement')
  assert.equal(dollarTokens(out).length, 0)
  assert.ok(!/50,?000/.test(out))
})

test('sanitizeExplanation rejects causal prose', () => {
  assert.equal(sanitizeExplanation('Increase due to expected rate hikes'), '')
  assert.equal(sanitizeExplanation('Higher because of new contract'), '')
})

test('sanitizeExplanation rejects text that reduces to too little', () => {
  assert.equal(sanitizeExplanation('$1,200'), '')
  assert.equal(sanitizeExplanation('the of for'), '')
})

// --- derivePhasing ---------------------------------------------------------

test('derivePhasing names the peak month when one month dominates', () => {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const cols = months.map((m, i) => ({ col: i, month: i }))
  // March dominates (~69%), the rest carry minor amounts.
  const row = [500, 500, 12000, 500, 500, 500, 500, 500, 500, 500, 500, 500]
  assert.equal(derivePhasing(row, cols), 'with budgeted spend weighted toward March')
})

test('derivePhasing reports even spread when no month dominates', () => {
  const cols = Array.from({ length: 12 }, (_, i) => ({ col: i, month: i }))
  const row = Array.from({ length: 12 }, () => 1000)
  assert.equal(derivePhasing(row, cols), 'with budgeted spend spread across the year')
})

test('derivePhasing returns null with too few months', () => {
  const cols = [{ col: 0, month: 0 }, { col: 1, month: 1 }]
  assert.equal(derivePhasing([1000, 2000], cols), null)
})

// --- budgetContextClause ---------------------------------------------------

test('budgetContextClause combines explanation and phasing, never a figure', () => {
  const clause = budgetContextClause({
    explanation: 'quarterly HVAC servicing',
    phasing: 'with budgeted spend weighted toward March'
  })
  assert.equal(clause, 'where the budget provides for quarterly HVAC servicing, with budgeted spend weighted toward March')
  assert.equal(dollarTokens(clause).length, 0)
  assert.equal(budgetContextClause({}), '')
})

// --- end-to-end enrichment -------------------------------------------------

test('uploaded budget adds supplemental explanation to a flagged account', () => {
  const supporting = [
    budgetFile({
      columns: ['Account', 'Notes'],
      rows: [['Utilities', 'Quarterly HVAC servicing and filter replacement']]
    })
  ]
  const note = baseNote()
  const out = enrichNarrative(narrativeWith(note), { supporting })
  const n = flagged(out)
  assert.match(n.text, /where the budget provides for quarterly HVAC servicing and filter replacement/)
  assert.equal(n.originalText, note.text)
  // The base figure is preserved and is the ONLY dollar amount stated.
  assert.deepEqual(dollarTokens(n.text), ['$10,000'])
})

test('uploaded budget figure is never shown; base figure wins (disagreement)', () => {
  // Uploaded file disagrees on the budget amount ($25,000) AND adds a note.
  const supporting = [
    budgetFile({
      columns: ['Account', 'Budget', 'Notes'],
      rows: [['Utilities', '25000', 'Routine landscaping and seasonal planting']]
    })
  ]
  const out = enrichNarrative(narrativeWith(baseNote()), { supporting })
  const n = flagged(out)
  assert.match(n.text, /routine landscaping and seasonal planting/)
  assert.deepEqual(dollarTokens(n.text), ['$10,000']) // never $25,000
  assert.ok(!/25,?000/.test(n.text))
})

test('budget summary (skipped by evidence index) still supplies context with no citation', () => {
  const supporting = [
    budgetFile({
      fileType: BUDGET_SUMMARY,
      columns: [
        'Account', 'Current Actual', 'Current Budget', 'Current Variance',
        'YTD Actual', 'YTD Budget', 'YTD Variance', 'Notes'
      ],
      rows: [['Utilities', '25000', '15000', '10000', '50000', '30000', '20000', 'Quarterly preventive maintenance program']]
    })
  ]
  const out = enrichNarrative(narrativeWith(baseNote()), { supporting })
  const n = flagged(out)
  assert.match(n.text, /where the budget provides for quarterly preventive maintenance program/)
  assert.equal(n.enriched, true)
  // No support array (it is not a GL citation), and none of the summary's other
  // figures leak in — only the base $10,000 remains.
  assert.equal(n.support, undefined)
  assert.deepEqual(dollarTokens(n.text), ['$10,000'])
})

test('monthly phasing is rendered qualitatively, with no monthly figure', () => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const supporting = [
    budgetFile({
      columns: ['Account', ...months],
      rows: [['Utilities', 500, 500, 12000, 500, 500, 500, 500, 500, 500, 500, 500, 500]]
    })
  ]
  const out = enrichNarrative(narrativeWith(baseNote()), { supporting })
  const n = flagged(out)
  assert.match(n.text, /with budgeted spend weighted toward March/)
  assert.deepEqual(dollarTokens(n.text), ['$10,000']) // never $12,000
})

test('causal budget prose is rejected; static clause is used instead', () => {
  const supporting = [
    budgetFile({
      columns: ['Account', 'Notes'],
      rows: [['Utilities', 'Increase due to expected rate hikes']]
    })
  ]
  const out = enrichNarrative(narrativeWith(baseNote()), { supporting })
  const n = flagged(out)
  assert.ok(!/due to/i.test(n.text))
  assert.match(n.text, /compared against scheduled budget assumptions for the period/)
})

test('no uploaded budget → narrative unchanged (same reference)', () => {
  const nar = narrativeWith(baseNote())
  assert.equal(enrichNarrative(nar, { supporting: [] }), nar)
})

test('uploaded budget with no matching account → narrative unchanged (same reference)', () => {
  const nar = narrativeWith(baseNote())
  const supporting = [
    budgetFile({ columns: ['Account', 'Notes'], rows: [['Insurance', 'Annual premium coverage']] })
  ]
  assert.equal(enrichNarrative(nar, { supporting }), nar)
})

test('budget file with no explanation and no months adds nothing', () => {
  // A plain account+budget grid (no Notes, no month columns) offers no new context.
  const index = buildBudgetContextIndex([
    budgetFile({ columns: ['Account', 'Budget'], rows: [['Utilities', '15000']] })
  ])
  assert.equal(index.length, 0)
  assert.equal(matchBudgetContext('Utilities', index), null)
})

test('Abbreviate setting is respected and the figure-free clause is inert', () => {
  const supporting = [
    budgetFile({
      columns: ['Account', 'Notes'],
      rows: [['Utilities', 'Quarterly HVAC servicing and filter replacement']]
    })
  ]
  const out = enrichNarrative(narrativeWith(baseNote()), { supporting })
  const abbreviated = applyDollarAbbreviation(out, true)
  const n = abbreviated.periods[0].highVariances[0]
  // Base figure abbreviated; the supplemental clause (no figures) is untouched.
  assert.match(n.text, /\$10K/)
  assert.match(n.text, /where the budget provides for quarterly HVAC servicing and filter replacement/)
})

// --- variance is never touched by the uploaded budget ----------------------

test('variance numbers, direction, and thresholds are byte-identical with vs without the budget file', () => {
  // A real base extraction with one flagged account.
  const base = {
    fileId: 'base',
    fileName: 'Variance Report.xlsx',
    status: 'ok',
    confidence: 95,
    classification: { type: 'Base Variance Report' },
    normalized: {
      columns: ['Account', 'Actual', 'Budget'],
      rows: [
        ['Utilities Expense', 25000, 15000],
        ['Rent Income', 5000, 5000]
      ],
      accounts: [],
      dates: [],
      values: []
    }
  }

  const variance = computeVariance(base)
  // computeVariance is single-input: the budget file is never passed to it, so its
  // output cannot depend on the upload. Recompute to confirm determinism.
  assert.deepEqual(computeVariance(base), variance)

  const narrative = generateNarrative(variance)
  const budget = budgetFile({
    columns: ['Account', 'Notes'],
    rows: [['Utilities Expense', 'Quarterly HVAC servicing and filter replacement']]
  })

  const without = enrichNarrative(narrative, { supporting: [] })
  const withBudget = enrichNarrative(narrative, { supporting: [budget] })

  // Collect the variance-bearing fields from every flagged note, both ways.
  const fields = (nar) =>
    nar.periods.flatMap((p) =>
      ['highVariances', 'revenueNotes', 'expenseNotes'].flatMap((k) =>
        (p[k] || []).map((n) => ({
          account: n.account,
          varianceAmount: n.varianceAmount,
          variancePercent: n.variancePercent,
          comparisonType: n.comparisonType,
          // The original variance sentence carries the figures/direction.
          base: n.originalText || n.text
        }))
      )
    )

  assert.deepEqual(fields(withBudget), fields(without))
})
