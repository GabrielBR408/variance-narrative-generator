// Generate-time file-role validation tests (Option A: auto-correct with notice).
// Runs on Node's built-in test runner (`node --test`).
//
// Covers the safety contract:
//   • High-confidence re-route only; low/unknown/ambiguous/failure ⇒ no change.
//   • Malformed JSON / thrown call / empty reply ⇒ no correction (silent).
//   • After a correction the REAL variance report reaches computeVariance.
//   • The notice rides through to the response and the Excel export header.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildRoleSamples,
  parseRoleResponse,
  applyRoleCorrection,
  validateFileRoles
} from '../server/validateRoles.js'
import { buildGenerateResponse } from '../server/generate.js'
import { buildExcelModel } from '../src/lib/export/excel.js'

// --- extraction factories --------------------------------------------------

function varianceReportEx({ fileId = 'vr', fileName = 'Income Statement.pdf' } = {}) {
  return {
    fileId,
    fileName,
    status: 'ok',
    confidence: 95,
    classification: { type: 'Base Variance Report' },
    normalized: {
      columns: ['Account', 'Actual', 'Budget'],
      rows: [
        ['Utilities Expense', 25000, 15000],
        ['Rent Income', 5000, 5000]
      ],
      accounts: [], dates: [], values: []
    }
  }
}

function budgetEx({ fileId = 'bud', fileName = 'GL Worksheet (1).pdf' } = {}) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return {
    fileId,
    fileName,
    status: 'ok',
    confidence: 95,
    classification: { type: 'General Ledger (GL)' }, // misclassified by filename
    normalized: {
      columns: ['Account', ...months],
      rows: [['Utilities Expense', 500, 500, 12000, 500, 500, 500, 500, 500, 500, 500, 500, 500]],
      accounts: [], dates: [], values: []
    }
  }
}

function glEx({ fileId = 'gl', fileName = 'Ledger.pdf' } = {}) {
  return {
    fileId,
    fileName,
    status: 'ok',
    confidence: 90,
    classification: { type: 'General Ledger (GL)' },
    normalized: {
      columns: ['Account', 'Date', 'Reference', 'Debit', 'Credit', 'Balance'],
      rows: [['Utilities Expense', '01/15/2026', 'INV100', 1200, 0, 1200]],
      accounts: [], dates: [], values: []
    }
  }
}

const high = (filename, role) => ({ filename, role, confidence: 'high' })

// --- buildRoleSamples ------------------------------------------------------

test('buildRoleSamples emits one compact sample per file, headers + few rows', () => {
  const samples = buildRoleSamples(budgetEx(), [varianceReportEx()])
  assert.equal(samples.length, 2)
  assert.equal(samples[0].currentRole, 'baseReport')
  assert.equal(samples[1].currentRole, 'supportingFile')
  assert.ok(Array.isArray(samples[0].columns) && samples[0].columns.length > 0)
  assert.ok(samples[0].sampleRows.length <= 5)
})

// --- parseRoleResponse -----------------------------------------------------

test('parseRoleResponse: valid high-confidence array → Map of assignments', () => {
  const text = JSON.stringify([high('Income Statement.pdf', 'variance_report'), high('GL Worksheet (1).pdf', 'standalone_budget')])
  const m = parseRoleResponse(text)
  assert.equal(m.get('Income Statement.pdf'), 'variance_report')
  assert.equal(m.get('GL Worksheet (1).pdf'), 'standalone_budget')
})

test('parseRoleResponse: low-confidence and invalid-role entries are dropped', () => {
  const text = JSON.stringify([
    { filename: 'a.pdf', role: 'variance_report', confidence: 'low' },
    { filename: 'b.pdf', role: 'nonsense', confidence: 'high' }
  ])
  const m = parseRoleResponse(text)
  assert.equal(m.size, 0)
})

test('parseRoleResponse: code-fenced JSON is tolerated', () => {
  const text = '```json\n' + JSON.stringify([high('x.pdf', 'general_ledger')]) + '\n```'
  assert.equal(parseRoleResponse(text).get('x.pdf'), 'general_ledger')
})

test('parseRoleResponse: malformed / non-array / empty → null', () => {
  assert.equal(parseRoleResponse('not json'), null)
  assert.equal(parseRoleResponse(JSON.stringify({ filename: 'a' })), null)
  assert.equal(parseRoleResponse(''), null)
  assert.equal(parseRoleResponse(null), null)
})

// --- applyRoleCorrection ---------------------------------------------------

test('applyRoleCorrection: budget in base + variance in supporting → corrects', () => {
  const base = budgetEx()
  const supporting = [varianceReportEx()]
  const files = [{ name: base.fileName, role: 'baseReport' }, { name: supporting[0].fileName, role: 'supportingFile' }]
  const assignments = new Map([[base.fileName, 'standalone_budget'], [supporting[0].fileName, 'variance_report']])
  const c = applyRoleCorrection({ base, supporting, files, assignments })
  assert.ok(c && c.corrected)
  assert.equal(c.base.fileName, 'Income Statement.pdf')
  assert.deepEqual(c.supporting.map((e) => e.fileName), ['GL Worksheet (1).pdf'])
  assert.match(c.notice, /adjusted automatically/)
  assert.match(c.notice, /Base report: Income Statement\.pdf/)
  // Files re-stamped to the corrected roles.
  assert.equal(c.files.find((f) => f.name === 'Income Statement.pdf').role, 'baseReport')
  assert.equal(c.files.find((f) => f.name === 'GL Worksheet (1).pdf').role, 'supportingFile')
})

test('applyRoleCorrection: GL in base + variance in supporting → corrects', () => {
  const base = glEx()
  const supporting = [varianceReportEx()]
  const assignments = new Map([[base.fileName, 'general_ledger'], [supporting[0].fileName, 'variance_report']])
  const c = applyRoleCorrection({ base, supporting, assignments })
  assert.ok(c && c.corrected)
  assert.equal(c.base.fileName, 'Income Statement.pdf')
})

test('applyRoleCorrection: base already the variance report → no correction', () => {
  const base = varianceReportEx()
  const supporting = [budgetEx()]
  const assignments = new Map([[base.fileName, 'variance_report'], [supporting[0].fileName, 'standalone_budget']])
  assert.equal(applyRoleCorrection({ base, supporting, assignments }), null)
})

test('applyRoleCorrection: ambiguous (two variance reports in supporting) → no correction', () => {
  const base = budgetEx()
  const supporting = [varianceReportEx({ fileId: 'a', fileName: 'A.pdf' }), varianceReportEx({ fileId: 'b', fileName: 'B.pdf' })]
  const assignments = new Map([['A.pdf', 'variance_report'], ['B.pdf', 'variance_report']])
  assert.equal(applyRoleCorrection({ base, supporting, assignments }), null)
})

test('applyRoleCorrection: no variance report identified → no correction', () => {
  const base = budgetEx()
  const supporting = [glEx()]
  const assignments = new Map([[base.fileName, 'standalone_budget'], [supporting[0].fileName, 'general_ledger']])
  assert.equal(applyRoleCorrection({ base, supporting, assignments }), null)
})

// --- validateFileRoles (injected callModel) --------------------------------

const callReturning = (text) => async () => text
const callThrowing = () => async () => { throw new Error('timeout') }

test('validateFileRoles: high-confidence swap → correction', async () => {
  const base = budgetEx()
  const supporting = [varianceReportEx()]
  const callModel = callReturning(JSON.stringify([high(base.fileName, 'standalone_budget'), high(supporting[0].fileName, 'variance_report')]))
  const c = await validateFileRoles({ base, supporting, files: [], callModel })
  assert.ok(c && c.corrected)
  assert.equal(c.base.fileName, 'Income Statement.pdf')
})

test('validateFileRoles: correct assignment → null', async () => {
  const base = varianceReportEx()
  const supporting = [budgetEx()]
  const callModel = callReturning(JSON.stringify([high(base.fileName, 'variance_report'), high(supporting[0].fileName, 'standalone_budget')]))
  assert.equal(await validateFileRoles({ base, supporting, callModel }), null)
})

test('validateFileRoles: malformed JSON → null', async () => {
  const c = await validateFileRoles({ base: budgetEx(), supporting: [varianceReportEx()], callModel: callReturning('garbage{') })
  assert.equal(c, null)
})

test('validateFileRoles: low confidence → null', async () => {
  const base = budgetEx()
  const supporting = [varianceReportEx()]
  const callModel = callReturning(JSON.stringify([{ filename: supporting[0].fileName, role: 'variance_report', confidence: 'low' }]))
  assert.equal(await validateFileRoles({ base, supporting, callModel }), null)
})

test('validateFileRoles: call throws (timeout) → null', async () => {
  const c = await validateFileRoles({ base: budgetEx(), supporting: [varianceReportEx()], callModel: callThrowing() })
  assert.equal(c, null)
})

test('validateFileRoles: empty reply (no API key path) → null', async () => {
  const c = await validateFileRoles({ base: budgetEx(), supporting: [varianceReportEx()], callModel: callReturning('') })
  assert.equal(c, null)
})

test('validateFileRoles: lone base with no supporting → null', async () => {
  const c = await validateFileRoles({ base: budgetEx(), supporting: [], callModel: callReturning(JSON.stringify([high('x', 'variance_report')])) })
  assert.equal(c, null)
})

// --- buildGenerateResponse integration (the corrected base reaches variance) -

function genArgs({ base, supporting, validate }) {
  return {
    files: [
      { name: base.fileName, size: 1, type: '', role: 'baseReport' },
      ...supporting.map((s) => ({ name: s.fileName, size: 1, type: '', role: 'supportingFile' }))
    ],
    extractions: { base, supporting },
    style: { reportStyle: 'Detailed' },
    variance: { dollarThreshold: 1000, percentThreshold: 10 },
    llmMode: 'cited',
    _validateForTest: validate
  }
}

test('buildGenerateResponse: a corrected base sends the REAL variance report to computeVariance', async () => {
  const base = budgetEx() // wrongly in the base slot
  const supporting = [varianceReportEx()] // the real comparative statement
  const validate = ({ base: b, supporting: s, files }) =>
    applyRoleCorrection({ base: b, supporting: s, files, assignments: new Map([[b.fileName, 'standalone_budget'], [s[0].fileName, 'variance_report']]) })

  const { status, body } = await buildGenerateResponse(genArgs({ base, supporting, validate }))
  assert.equal(status, 200)
  // The variance now reflects the income statement (Utilities flagged), not the
  // budget (which yields no comparable period).
  assert.ok(body.variance.summary.totalVariancesFound > 0, 'real variance computed from the corrected base')
  assert.equal(body.variance.fileName, 'Income Statement.pdf')
  assert.ok(body.correction && body.correction.corrected)
  assert.match(body.correction.notice, /adjusted automatically/)
  assert.equal(body.correction.baseFileId, 'vr')
  // Response files are re-stamped to the corrected roles.
  assert.equal(body.files.find((f) => f.name === 'Income Statement.pdf').role, 'baseReport')
})

test('buildGenerateResponse: no correction → variance from the original base, correction null', async () => {
  const base = varianceReportEx()
  const supporting = [budgetEx()]
  const validate = () => null // validator finds nothing to change
  const { status, body } = await buildGenerateResponse(genArgs({ base, supporting, validate }))
  assert.equal(status, 200)
  assert.equal(body.variance.fileName, 'Income Statement.pdf')
  assert.ok(body.variance.summary.totalVariancesFound > 0)
  assert.equal(body.correction, null)
})

test('buildGenerateResponse: a budget left in the base slot is now AUTO-CORRECTED by the structural gate (no silent zero-variance, no manual swap)', async () => {
  // Phase: structural auto-correct. When the LLM validator returns null (no
  // API key, low confidence, etc.) and exactly one supporting file structurally
  // looks like a variance report, the base gate swaps roles automatically and
  // generation proceeds — same correction object shape the LLM path produces,
  // so the UI notice and Excel "File Roles" header render identically.
  const base = budgetEx()
  const supporting = [varianceReportEx()]
  const { status, body } = await buildGenerateResponse(genArgs({ base, supporting, validate: () => null }))
  assert.equal(status, 200)
  assert.equal(body.success, true)
  assert.equal(body.variance.fileName, 'Income Statement.pdf')
  assert.ok(body.variance.summary.totalVariancesFound > 0)
  assert.ok(body.correction && body.correction.corrected)
  assert.match(body.correction.notice, /Income Statement\.pdf/)
})

test('buildGenerateResponse: a budget left in the base slot AND no IS supporting is REJECTED with the smarter, file-naming message', async () => {
  const base = budgetEx()
  const { status, body } = await buildGenerateResponse(genArgs({ base, supporting: [], validate: () => null }))
  assert.equal(status, 422)
  assert.equal(body.success, false)
  assert.match(body.error, /comparative variance report/i)
  assert.match(body.error, new RegExp(base.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal(body.variance, undefined)
})

// --- Excel export header carries the notice --------------------------------

test('buildExcelModel: a correction adds a "File Roles" meta row; absence adds none', () => {
  const narrative = { fileName: 'Income Statement.pdf', classification: 'Base Variance Report', thresholds: {}, periods: [] }
  const withFix = buildExcelModel(narrative, { correction: { notice: 'We detected your files were assigned different roles than uploaded — we’ve adjusted automatically. Base report: Income Statement.pdf. Supporting: GL Worksheet (1).pdf. Generating now.' } })
  const roleRow = withFix.meta.find((m) => m.label === 'File Roles')
  assert.ok(roleRow, 'File Roles meta row present')
  assert.match(roleRow.value, /adjusted automatically/)

  const without = buildExcelModel(narrative, {})
  assert.equal(without.meta.find((m) => m.label === 'File Roles'), undefined)
})
