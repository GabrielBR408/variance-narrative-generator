// Pre-generate base file validation gate — structural, no LLM.
// Runs on Node's built-in test runner (`node --test`).
//
// Contract:
//   • A misrouted base (a budget or a GL in the base slot) is either
//     auto-corrected (when EXACTLY one supporting file passes the structural
//     check) or REJECTED with a smarter, file-naming message. No silent
//     zero-variance result is produced.
//   • A real comparative income statement PASSES; generation proceeds normally.
//   • Both the server path (buildGenerateResponse) and the static-host fallback
//     (clientGenerate) gate identically (one orchestrator, two callers).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  checkBaseIsVarianceReport,
  evaluateBaseRouting,
  buildSwapNotice,
  messageNoCandidate,
  messageMultipleCandidates,
  BASE_GATE_NO_COLUMNS,
  BASE_GATE_NO_COMPARISON,
  BASE_GATE_OK,
  BASE_GATE_AUTO_CORRECTED,
  BASE_GATE_NO_CANDIDATE,
  BASE_GATE_MULTIPLE_CANDIDATES
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

const wrap = (normalized, fileName = 'Base.pdf', fileId = null) => ({
  fileId: fileId || fileName, fileName, status: 'ok', confidence: 95,
  classification: { type: 'Base Variance Report' }, normalized
})

// --- checkBaseIsVarianceReport (single-file pass/fail) ---------------------

test('Kardin budget as base → check FAILS (no Actual column)', () => {
  const r = checkBaseIsVarianceReport(kardinBudgetNorm(), 'Budget.pdf')
  assert.equal(r.ok, false)
  assert.equal(r.reason, BASE_GATE_NO_COMPARISON)
  assert.match(r.message, /Budget\.pdf/)
})

test('General Ledger as base → check FAILS (Debit/Credit, no Actual/Budget)', () => {
  const r = checkBaseIsVarianceReport(glNorm(), 'Ledger.pdf')
  assert.equal(r.ok, false)
  assert.equal(r.reason, BASE_GATE_NO_COMPARISON)
})

test('Real comparative income statement → check PASSES', () => {
  const r = checkBaseIsVarianceReport(varianceReportNorm(), 'IS.pdf')
  assert.equal(r.ok, true)
  assert.equal(r.reason, BASE_GATE_OK)
  assert.equal(r.message, '')
})

test('Empty / non-tabular normalized → check FAILS (no-columns)', () => {
  assert.equal(checkBaseIsVarianceReport({ columns: [], rows: [] }).reason, BASE_GATE_NO_COLUMNS)
  assert.equal(checkBaseIsVarianceReport(null).reason, BASE_GATE_NO_COLUMNS)
  assert.equal(checkBaseIsVarianceReport(undefined).reason, BASE_GATE_NO_COLUMNS)
})

test('Actual + Prior (no budget) is also a comparable set → check PASSES', () => {
  const r = checkBaseIsVarianceReport({
    columns: ['Account', 'Actual', 'Prior Month'],
    rows: [['Utilities Expense', 25000, 15000]],
    accounts: [], dates: [], values: []
  })
  assert.equal(r.ok, true)
})

// --- Messages (named + actionable) -----------------------------------------

test('No-candidate message names the offending base file and tells the user what to do', () => {
  const m = messageNoCandidate('GL Worksheet (1).pdf')
  assert.match(m, /GL Worksheet \(1\)\.pdf/)
  assert.match(m, /comparative variance report/i)
  assert.match(m, /no Actual vs Budget columns/i)
  assert.match(m, /upload a comparative income statement/i)
  assert.match(m, /actual and budget figures/i)
})

test('Multiple-candidates message names the base AND lists candidates', () => {
  const m = messageMultipleCandidates('Budget.pdf', ['IS-Q1.pdf', 'IS-Q2.pdf'])
  assert.match(m, /Budget\.pdf/)
  assert.match(m, /Multiple files could be the base/i)
  assert.match(m, /IS-Q1\.pdf/)
  assert.match(m, /IS-Q2\.pdf/)
  assert.match(m, /re-upload with the correct income statement as the first file/i)
})

test('Swap notice names BOTH the original (wrong) base AND the promoted file', () => {
  const m = buildSwapNotice('GL Worksheet (1).pdf', 'Income Statement.pdf')
  assert.match(m, /GL Worksheet \(1\)\.pdf/)
  assert.match(m, /Income Statement\.pdf/)
  assert.match(m, /not a variance report/i)
  assert.match(m, /right base file/i)
  assert.match(m, /adjusted the roles automatically/i)
})

// --- evaluateBaseRouting (orchestrator) ------------------------------------

test('orchestrator: real IS as base → PASS (no correction)', () => {
  const out = evaluateBaseRouting({
    base: wrap(varianceReportNorm(), 'IS.pdf'),
    supporting: [wrap(glNorm(), 'Ledger.pdf')]
  })
  assert.equal(out.outcome, 'pass')
  assert.equal(out.reason, BASE_GATE_OK)
})

test('orchestrator: budget as base, IS as supporting → AUTO-CORRECT (swap)', () => {
  const baseEx = wrap(kardinBudgetNorm(), 'Kardin Budget.pdf')
  const supEx = wrap(varianceReportNorm(), 'Income Statement.pdf')
  const out = evaluateBaseRouting({ base: baseEx, supporting: [supEx] })
  assert.equal(out.outcome, 'auto_correct')
  assert.equal(out.reason, BASE_GATE_AUTO_CORRECTED)
  // The variance report is now the base; the original base is demoted.
  assert.equal(out.base.fileName, 'Income Statement.pdf')
  assert.equal(out.supporting[0].fileName, 'Kardin Budget.pdf')
  // Correction object carries the notice and IDs downstream UI/exports expect.
  assert.equal(out.correction.corrected, true)
  assert.match(out.correction.notice, /Kardin Budget\.pdf/)
  assert.match(out.correction.notice, /Income Statement\.pdf/)
  assert.equal(out.correction.baseFileId, 'Income Statement.pdf')
  assert.deepEqual(out.correction.supportingFileIds, ['Kardin Budget.pdf'])
})

test('orchestrator: GL as base, IS as supporting → AUTO-CORRECT', () => {
  const out = evaluateBaseRouting({
    base: wrap(glNorm(), 'Ledger.pdf'),
    supporting: [wrap(varianceReportNorm(), 'IS.pdf')]
  })
  assert.equal(out.outcome, 'auto_correct')
  assert.equal(out.base.fileName, 'IS.pdf')
})

test('orchestrator: budget as base, GL as supporting (no IS) → STOP_NO_CANDIDATE', () => {
  const out = evaluateBaseRouting({
    base: wrap(kardinBudgetNorm(), 'Kardin Budget.pdf'),
    supporting: [wrap(glNorm(), 'Ledger.pdf')]
  })
  assert.equal(out.outcome, 'stop_no_candidate')
  assert.equal(out.reason, BASE_GATE_NO_CANDIDATE)
  assert.equal(out.baseFileName, 'Kardin Budget.pdf')
  assert.match(out.message, /Kardin Budget\.pdf/)
  assert.match(out.message, /actual and budget figures/i)
})

test('orchestrator: budget as only file → STOP_NO_CANDIDATE (original gate behavior, smarter message)', () => {
  const out = evaluateBaseRouting({
    base: wrap(kardinBudgetNorm(), 'Kardin Budget.pdf'),
    supporting: []
  })
  assert.equal(out.outcome, 'stop_no_candidate')
  assert.match(out.message, /Kardin Budget\.pdf/)
})

test('orchestrator: budget as base + TWO IS supporting → STOP_MULTIPLE_CANDIDATES', () => {
  const out = evaluateBaseRouting({
    base: wrap(kardinBudgetNorm(), 'Kardin Budget.pdf'),
    supporting: [
      wrap(varianceReportNorm(), 'IS-Q1.pdf'),
      wrap(varianceReportNorm(), 'IS-Q2.pdf')
    ]
  })
  assert.equal(out.outcome, 'stop_multiple_candidates')
  assert.equal(out.reason, BASE_GATE_MULTIPLE_CANDIDATES)
  assert.deepEqual(out.candidateNames, ['IS-Q1.pdf', 'IS-Q2.pdf'])
  assert.match(out.message, /Kardin Budget\.pdf/)
  assert.match(out.message, /IS-Q1\.pdf/)
  assert.match(out.message, /IS-Q2\.pdf/)
})

// --- buildGenerateResponse: orchestrator wired into the server path --------

function args({ baseNormalized, baseName = 'Base.pdf', supporting = [], extras = {} }) {
  return {
    files: [
      { name: baseName, size: 1, type: '', role: 'baseReport' },
      ...supporting.map((s) => ({ name: s.fileName, size: 1, type: '', role: 'supportingFile' }))
    ],
    extractions: { base: wrap(baseNormalized, baseName), supporting },
    style: { reportStyle: 'Detailed' },
    variance: { dollarThreshold: 1000, percentThreshold: 10 },
    llmMode: 'cited',
    ...extras
  }
}

test('buildGenerateResponse: budget as base, IS as supporting → 200, auto-corrected, variance produced', async () => {
  const supporting = [wrap(varianceReportNorm(), 'Income Statement.pdf')]
  const { status, body } = await buildGenerateResponse(
    args({ baseNormalized: kardinBudgetNorm(), baseName: 'Kardin Budget.pdf', supporting })
  )
  assert.equal(status, 200)
  assert.equal(body.success, true)
  assert.ok(body.variance)
  assert.ok(body.variance.summary.totalVariancesFound > 0)
  // Correction notice carried out for the UI and Excel "File Roles" header.
  assert.ok(body.correction)
  assert.equal(body.correction.corrected, true)
  assert.match(body.correction.notice, /Kardin Budget\.pdf/)
  assert.match(body.correction.notice, /Income Statement\.pdf/)
  // Roles in the response files[] are re-stamped to the corrected routing.
  const baseFile = body.files.find((f) => f.role === 'baseReport')
  assert.equal(baseFile.name, 'Income Statement.pdf')
})

test('buildGenerateResponse: budget as ONLY file → 422 + smarter message naming the base', async () => {
  const { status, body } = await buildGenerateResponse(
    args({ baseNormalized: kardinBudgetNorm(), baseName: 'Kardin Budget.pdf', supporting: [] })
  )
  assert.equal(status, 422)
  assert.equal(body.success, false)
  assert.equal(body.errorCode, BASE_GATE_NO_CANDIDATE)
  assert.match(body.error, /Kardin Budget\.pdf/)
  assert.match(body.error, /actual and budget figures/i)
  assert.equal(body.variance, undefined)
  assert.equal(body.narrative, undefined)
})

test('buildGenerateResponse: budget as base + GL as supporting → 422 + smarter message naming the base', async () => {
  const supporting = [wrap(glNorm(), 'Ledger.pdf')]
  const { status, body } = await buildGenerateResponse(
    args({ baseNormalized: kardinBudgetNorm(), baseName: 'Kardin Budget.pdf', supporting })
  )
  assert.equal(status, 422)
  assert.equal(body.errorCode, BASE_GATE_NO_CANDIDATE)
  assert.match(body.error, /Kardin Budget\.pdf/)
})

test('buildGenerateResponse: budget as base + TWO IS supporting → 422 + multiple-candidates message', async () => {
  const supporting = [
    wrap(varianceReportNorm(), 'IS-Q1.pdf'),
    wrap(varianceReportNorm(), 'IS-Q2.pdf')
  ]
  const { status, body } = await buildGenerateResponse(
    args({ baseNormalized: kardinBudgetNorm(), baseName: 'Kardin Budget.pdf', supporting })
  )
  assert.equal(status, 422)
  assert.equal(body.errorCode, BASE_GATE_MULTIPLE_CANDIDATES)
  assert.match(body.error, /Kardin Budget\.pdf/)
  assert.match(body.error, /IS-Q1\.pdf/)
  assert.match(body.error, /IS-Q2\.pdf/)
})

test('buildGenerateResponse: a real comparative IS in the base slot → 200, no correction', async () => {
  const { status, body } = await buildGenerateResponse(
    args({ baseNormalized: varianceReportNorm(), baseName: 'Income Statement.pdf' })
  )
  assert.equal(status, 200)
  assert.equal(body.success, true)
  assert.ok(body.variance)
  assert.ok(body.variance.summary.totalVariancesFound > 0)
  assert.equal(body.correction, null)
})

// --- clientGenerate (static-host fallback) gates identically ---------------

test('clientGenerate: budget as base, IS as supporting → success + correction (auto-correct)', () => {
  const baseExtraction = wrap(kardinBudgetNorm(), 'Kardin Budget.pdf')
  const supportingExtractions = [wrap(varianceReportNorm(), 'Income Statement.pdf')]
  const res = clientGenerate({
    baseExtraction,
    supportingExtractions,
    files: [
      { name: 'Kardin Budget.pdf', size: 1, type: '', role: 'baseReport' },
      { name: 'Income Statement.pdf', size: 1, type: '', role: 'supportingFile' }
    ],
    thresholds: { amount: 1000, percent: 10 }
  })
  assert.equal(res.success, true)
  assert.ok(res.variance)
  assert.ok(res.correction)
  assert.match(res.correction.notice, /Kardin Budget\.pdf/)
  assert.match(res.correction.notice, /Income Statement\.pdf/)
  const baseFile = res.files.find((f) => f.role === 'baseReport')
  assert.equal(baseFile.name, 'Income Statement.pdf')
})

test('clientGenerate: budget as only file → { success:false, smarter message }', () => {
  const res = clientGenerate({
    baseExtraction: wrap(kardinBudgetNorm(), 'Kardin Budget.pdf'),
    supportingExtractions: [],
    files: [{ name: 'Kardin Budget.pdf', size: 1, type: '', role: 'baseReport' }],
    thresholds: { amount: 1000, percent: 10 }
  })
  assert.equal(res.success, false)
  assert.equal(res.errorCode, BASE_GATE_NO_CANDIDATE)
  assert.match(res.error, /Kardin Budget\.pdf/)
})

test('clientGenerate: budget as base + 2 IS supporting → { success:false, multiple-candidates message }', () => {
  const res = clientGenerate({
    baseExtraction: wrap(kardinBudgetNorm(), 'Kardin Budget.pdf'),
    supportingExtractions: [
      wrap(varianceReportNorm(), 'IS-Q1.pdf'),
      wrap(varianceReportNorm(), 'IS-Q2.pdf')
    ],
    files: [],
    thresholds: { amount: 1000, percent: 10 }
  })
  assert.equal(res.success, false)
  assert.equal(res.errorCode, BASE_GATE_MULTIPLE_CANDIDATES)
  assert.match(res.error, /Kardin Budget\.pdf/)
  assert.match(res.error, /IS-Q1\.pdf/)
})

test('clientGenerate: a real comparative IS → success, no correction', () => {
  const res = clientGenerate({
    baseExtraction: wrap(varianceReportNorm()),
    supportingExtractions: [],
    files: [],
    thresholds: { amount: 1000, percent: 10 }
  })
  assert.equal(res.success, true)
  assert.ok(res.variance)
  assert.equal(res.correction, null)
})
