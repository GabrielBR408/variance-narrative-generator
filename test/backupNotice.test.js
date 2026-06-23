// Insufficient-backup notice — logic tests (pure; no JSX/deps).
//
// DETECTION = presence / file-type only. A recommendation appears ONLY for an
// input that was actually needed and absent:
//   • budget — only when there is NO budget basis at all (the variance was not
//     computed against a budget). A separate budget FILE is never read for the
//     basis in this app, so its absence alone is NOT a reason to recommend one.
//   • GL — when no General Ledger file was provided.
// Case #3 (current-month-only GL) is intentionally not detected (unreliable).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  backupNotice,
  BUDGET_RECOMMENDATION,
  GL_RECOMMENDATION
} from '../src/lib/backupNotice.js'

// A minimal narrative with one note of the given comparisonType.
function narrativeWith(comparisonType) {
  return {
    periods: [{
      period: 'current',
      highVariances: [{ account: 'X', comparisonType }],
      revenueNotes: [], expenseNotes: [], missingData: []
    }]
  }
}

const GL_FILE = { name: '4. General Ledger.pdf', role: 'supportingFile' }
const BUDGET_FILE = { name: '2026 Budget.xlsx', role: 'supportingFile' }
const BASE_FILE = { name: 'Comparative Income Statement.xlsx', role: 'baseReport' }
// variance column maps
const BUDGET_COLUMNS = { columns: { account: 0, actual: 1, budget: 2, prior: null } }
const PRIOR_ONLY_COLUMNS = { columns: { account: 0, actual: 1, budget: null, prior: 2 } }

// --- case #1: budget recommendation ----------------------------------------

test('no budget basis -> budget recommendation shows', () => {
  const notice = backupNotice({ variance: PRIOR_ONLY_COLUMNS, files: [BASE_FILE, GL_FILE] })
  assert.ok(notice)
  assert.ok(notice.recommendations.includes(BUDGET_RECOMMENDATION))
})

test('budget basis present (variance column) -> NO budget recommendation (app made do)', () => {
  const notice = backupNotice({ variance: BUDGET_COLUMNS, files: [BASE_FILE, GL_FILE] })
  assert.equal(notice, null)
})

test('budget basis present via note comparisonType fallback -> NO budget recommendation', () => {
  // No variance column map, but a budget-based note proves actuals met a budget.
  const notice = backupNotice({ narrative: narrativeWith('budget'), files: [BASE_FILE, GL_FILE] })
  assert.equal(notice, null)
})

test('a prior-only note does NOT count as a budget basis', () => {
  const notice = backupNotice({ narrative: narrativeWith('prior'), files: [BASE_FILE, GL_FILE] })
  assert.ok(notice)
  assert.deepEqual(notice.recommendations, [BUDGET_RECOMMENDATION])
})

// --- case #2: GL recommendation --------------------------------------------

test('no GL file -> GL recommendation shows', () => {
  const notice = backupNotice({ variance: BUDGET_COLUMNS, files: [BASE_FILE, BUDGET_FILE] })
  assert.ok(notice)
  assert.deepEqual(notice.recommendations, [GL_RECOMMENDATION])
})

test('GL file present -> NO GL recommendation', () => {
  const notice = backupNotice({ variance: BUDGET_COLUMNS, files: [BASE_FILE, GL_FILE] })
  assert.equal(notice, null)
})

test('a bare "gl" stem is recognized as a General Ledger', () => {
  const notice = backupNotice({ variance: BUDGET_COLUMNS, files: [BASE_FILE, { name: 'gl.csv', role: 'supportingFile' }] })
  assert.equal(notice, null)
})

// --- all present / combined -------------------------------------------------

test('all needed inputs present/sufficient -> NO notice', () => {
  const notice = backupNotice({ variance: BUDGET_COLUMNS, narrative: narrativeWith('budget'), files: [BASE_FILE, GL_FILE] })
  assert.equal(notice, null)
})

test('multiple missing -> one combined notice (budget + GL), not stacked', () => {
  const notice = backupNotice({ variance: PRIOR_ONLY_COLUMNS, files: [BASE_FILE] })
  assert.ok(notice)
  assert.deepEqual(notice.recommendations, [BUDGET_RECOMMENDATION, GL_RECOMMENDATION])
  // A single object (one notice) carrying both lines — never two notice objects.
  assert.equal(typeof notice, 'object')
  assert.ok(!Array.isArray(notice))
})

test('empty input is treated as everything-missing (degrades cleanly)', () => {
  const notice = backupNotice({})
  assert.deepEqual(notice.recommendations, [BUDGET_RECOMMENDATION, GL_RECOMMENDATION])
})
