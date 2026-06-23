// Pre-generate base file validation gate — structural, no LLM.
// Runs on Node's built-in test runner (`node --test`).
//
// Contract:
//   • A misrouted base (a budget or a GL in the base slot) is REJECTED with a
//     clear, actionable message. Generation stops — computeVariance is never
//     called and no zero-variance result is produced.
//   • A real comparative income statement PASSES; generation proceeds normally.
//   • Both the server path (buildGenerateResponse) and the static-host fallback
//     (clientGenerate) gate identically (one helper, two callers).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  checkBaseIsVarianceReport,
  BASE_GATE_MESSAGE,
  BASE_GATE_NO_COLUMNS,
  BASE_GATE_NO_COMPARISON,
  BASE_GATE_OK
} from '../src/lib/variance/baseGate.js'
import { buildGenerateResponse } from '../server/generate.js'
import { clientGenerate } from '../src/lib/clientGenerate.js'

// --- normalized factories --------------------------------------------------

function varianceReportNorm() {
  return {
    columns: ['Account', 'Actual', 'Budget'],
    rows: [
      ['Utilities Expense', 25000, 15000],
      ['Rent Income', 5000, 5000]
    ],
    accounts: [], dates: [], values: []
  }
}

function kardinBudgetNorm() {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return {
    columns: ['Account', ...months],
    rows: [['Utilities Expense', 500, 500, 12000, 500, 500, 500, 500, 500, 500, 500, 500, 500]],
    accounts: [], dates: [], values: []
  }
}

function glNorm() {
  return {
    columns: ['Account', 'Date', 'Reference', 'Debit', 'Credit', 'Balance'],
    rows: [['Utilities Expense', '01/15/2026', 'INV100', 1200, 0, 1200]],
    accounts: [], dates: [], values: []
  }
}

const wrap = (normalized, fileName = 'Base.pdf') => ({
  fileId: fileName, fileName, status: 'ok', confidence: 95,
  classification: { type: 'Base Variance Report' }, normalized
})

// --- checkBaseIsVarianceReport (unit) --------------------------------------

test('Kardin budget as base → gate FAILS (no Actual column)', () => {
  const r = checkBaseIsVarianceReport(kardinBudgetNorm())
  assert.equal(r.ok, false)
  assert.equal(r.reason, BASE_GATE_NO_COMPARISON)
  assert.equal(r.message, BASE_GATE_MESSAGE)
})

test('General Ledger as base → gate FAILS (Debit/Credit, no Actual/Budget)', () => {
  const r = checkBaseIsVarianceReport(glNorm())
  assert.equal(r.ok, false)
  assert.equal(r.reason, BASE_GATE_NO_COMPARISON)
})

test('Real comparative income statement as base → gate PASSES', () => {
  const r = checkBaseIsVarianceReport(varianceReportNorm())
  assert.equal(r.ok, true)
  assert.equal(r.reason, BASE_GATE_OK)
  assert.equal(r.message, '')
})

test('Empty / non-tabular normalized → gate FAILS (no-columns)', () => {
  assert.equal(checkBaseIsVarianceReport({ columns: [], rows: [] }).reason, BASE_GATE_NO_COLUMNS)
  assert.equal(checkBaseIsVarianceReport(null).reason, BASE_GATE_NO_COLUMNS)
  assert.equal(checkBaseIsVarianceReport(undefined).reason, BASE_GATE_NO_COLUMNS)
})

test('Actual + Prior (no budget) is also a comparable set → gate PASSES', () => {
  const r = checkBaseIsVarianceReport({
    columns: ['Account', 'Actual', 'Prior Month'],
    rows: [['Utilities Expense', 25000, 15000]],
    accounts: [], dates: [], values: []
  })
  assert.equal(r.ok, true)
})

test('Gate message names "Actual vs Budget" and tells the user what to do next', () => {
  const m = BASE_GATE_MESSAGE
  assert.match(m, /comparative variance report/i)
  assert.match(m, /Actual vs Budget/i)
  assert.match(m, /upload a comparative income statement/i)
  assert.match(m, /Supporting files like budgets and GL detail can be added alongside/i)
})

// --- buildGenerateResponse: gate stops generation before computeVariance ---

function args({ baseNormalized, baseName = 'Base.pdf' }) {
  return {
    files: [{ name: baseName, size: 1, type: '', role: 'baseReport' }],
    extractions: { base: wrap(baseNormalized, baseName), supporting: [] },
    style: { reportStyle: 'Detailed' },
    variance: { dollarThreshold: 1000, percentThreshold: 10 },
    llmMode: 'cited'
  }
}

test('buildGenerateResponse: a Kardin budget in the base slot → 422 + gate message; no variance produced', async () => {
  const { status, body } = await buildGenerateResponse(args({ baseNormalized: kardinBudgetNorm(), baseName: 'GL Worksheet (1).pdf' }))
  assert.equal(status, 422)
  assert.equal(body.success, false)
  assert.equal(body.error, BASE_GATE_MESSAGE)
  assert.equal(body.errorCode, BASE_GATE_NO_COMPARISON)
  // No variance / narrative body at all — the silent zero-variance result the
  // gate replaces is gone.
  assert.equal(body.variance, undefined)
  assert.equal(body.narrative, undefined)
})

test('buildGenerateResponse: a GL in the base slot → 422 + gate message', async () => {
  const { status, body } = await buildGenerateResponse(args({ baseNormalized: glNorm(), baseName: 'Ledger.pdf' }))
  assert.equal(status, 422)
  assert.equal(body.error, BASE_GATE_MESSAGE)
})

test('buildGenerateResponse: a real comparative IS in the base slot → 200 + variance produced', async () => {
  const { status, body } = await buildGenerateResponse(args({ baseNormalized: varianceReportNorm(), baseName: 'Income Statement.pdf' }))
  assert.equal(status, 200)
  assert.equal(body.success, true)
  assert.ok(body.variance, 'variance produced')
  assert.ok(body.variance.summary.totalVariancesFound > 0)
})

// --- clientGenerate (static-host fallback) gates identically ---------------

test('clientGenerate: a Kardin budget in the base slot → { success:false, gate message }', () => {
  const res = clientGenerate({ baseExtraction: wrap(kardinBudgetNorm()), files: [], thresholds: { amount: 1000, percent: 10 } })
  assert.equal(res.success, false)
  assert.equal(res.error, BASE_GATE_MESSAGE)
  assert.equal(res.errorCode, BASE_GATE_NO_COMPARISON)
})

test('clientGenerate: a real comparative IS → success', () => {
  const res = clientGenerate({ baseExtraction: wrap(varianceReportNorm()), files: [], thresholds: { amount: 1000, percent: 10 } })
  assert.equal(res.success, true)
  assert.ok(res.variance)
})
