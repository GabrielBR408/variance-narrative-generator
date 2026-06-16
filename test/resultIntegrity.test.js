// Result integrity + generate clarity tests — Phase 22.3.
// Runs on Node's built-in test runner (`node --test`), no DOM, no extra deps.
//
// Covers the pure logic behind:
//   • file-set freshness (changing files marks the result stale),
//   • discarding a result whose base report was removed,
//   • the "supporting files still processing" non-blocking warning,
//   • the explicit narrative-preview empty state.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  resultFreshness,
  shouldDiscardResult,
  pendingSupportingCount,
  pendingSupportingWarningVisible
} from '../src/lib/generateState.js'
import { previewNarrativeState, BASE_TYPE } from '../src/lib/previewNarrative.js'

// Settings + file-set snapshot shape carried on a generated result.
const SNAP = {
  amountThreshold: 1000,
  percentThreshold: 10,
  commentaryMode: 'detailed',
  baseKey: 'base.xlsx::100::1',
  supportingKeys: ['gl.pdf::50::2']
}

// --- 1. File changes → stale (reuses the freshness banner) -----------------

test('replacing the base report marks the result stale (files)', () => {
  const f = resultFreshness({ generated: SNAP, current: { ...SNAP, baseKey: 'other.xlsx::200::9' } })
  assert.equal(f.stale, true)
  assert.deepEqual(f.changed, ['files'])
})

test('adding a supporting file marks the result stale (files)', () => {
  const f = resultFreshness({
    generated: SNAP,
    current: { ...SNAP, supportingKeys: ['gl.pdf::50::2', 'budget.xlsx::70::3'] }
  })
  assert.equal(f.stale, true)
  assert.deepEqual(f.changed, ['files'])
})

test('removing a supporting file marks the result stale (files)', () => {
  const f = resultFreshness({ generated: SNAP, current: { ...SNAP, supportingKeys: [] } })
  assert.equal(f.stale, true)
  assert.deepEqual(f.changed, ['files'])
})

test('identical file set + settings → not stale', () => {
  const f = resultFreshness({ generated: SNAP, current: { ...SNAP, supportingKeys: ['gl.pdf::50::2'] } })
  assert.equal(f.stale, false)
  assert.deepEqual(f.changed, [])
})

test('file + threshold drift are both reported', () => {
  const f = resultFreshness({
    generated: SNAP,
    current: { ...SNAP, amountThreshold: 5000, supportingKeys: [] }
  })
  assert.equal(f.stale, true)
  assert.deepEqual(f.changed, ['thresholds', 'files'])
})

test('snapshots without file identities never flag files (back-compat)', () => {
  const legacy = { amountThreshold: 1000, percentThreshold: 10, commentaryMode: 'detailed' }
  const f = resultFreshness({
    generated: legacy,
    current: { ...legacy, baseKey: 'x', supportingKeys: ['y'] }
  })
  assert.equal(f.stale, false)
  assert.deepEqual(f.changed, [])
})

// --- 2. Remove base → clears result ----------------------------------------

test('a result with no base report must be discarded', () => {
  assert.equal(shouldDiscardResult({ hasBase: false, hasResult: true }), true)
})

test('a result with a base report is kept', () => {
  assert.equal(shouldDiscardResult({ hasBase: true, hasResult: true }), false)
})

test('nothing to discard when there is no result', () => {
  assert.equal(shouldDiscardResult({ hasBase: false, hasResult: false }), false)
})

// --- 3. Pending supporting → non-blocking warning --------------------------

test('pendingSupportingCount counts only files still extracting', () => {
  const exts = [
    { status: 'ok' },
    { status: 'pending' },
    { status: 'pending' },
    { status: 'error' }
  ]
  assert.equal(pendingSupportingCount(exts), 2)
  assert.equal(pendingSupportingCount([]), 0)
  assert.equal(pendingSupportingCount(undefined), 0)
})

test('warning shows only when the base is ready and a supporting file is pending', () => {
  assert.equal(pendingSupportingWarningVisible({ ready: true, pendingCount: 1 }), true)
  assert.equal(pendingSupportingWarningVisible({ ready: true, pendingCount: 0 }), false)
  assert.equal(pendingSupportingWarningVisible({ ready: false, pendingCount: 3 }), false)
  assert.equal(pendingSupportingWarningVisible({}), false)
})

// --- 4. Narrative preview empty state --------------------------------------

function baseExtraction(overrides = {}) {
  return {
    fileId: 'base',
    fileName: 'Income Statement.xlsx',
    status: 'ok',
    confidence: 90,
    classification: { type: BASE_TYPE },
    normalized: {
      columns: ['Account', 'Actual', 'Budget'],
      rows: [['Repairs', '5000', '1000']],
      accounts: [], dates: [], values: []
    },
    ...overrides
  }
}

// A base that extracted cleanly but has no Actual-vs-Budget/Prior comparison.
function noComparableBase() {
  return baseExtraction({
    normalized: { columns: ['Account', 'Notes'], rows: [['Repairs', 'see schedule']], accounts: [], dates: [], values: [] }
  })
}

test('a usable base yields a narrative preview', () => {
  const state = previewNarrativeState({ items: [baseExtraction()] })
  assert.equal(state.kind, 'narrative')
  assert.ok(state.narrative)
})

test('base ok but no comparable columns → explicit empty state (not silent null)', () => {
  const state = previewNarrativeState({ items: [noComparableBase()] })
  assert.equal(state.kind, 'empty')
  assert.equal(state.narrative, null)
})

test('no base at all → none (other surfaces guide the user)', () => {
  const gl = {
    fileId: 'gl', fileName: 'GL.pdf', status: 'ok',
    classification: { type: 'General Ledger (GL)' },
    normalized: { columns: ['Account', 'Amount'], rows: [['x', '1']], accounts: [], dates: [], values: [] }
  }
  assert.equal(previewNarrativeState({ items: [gl] }).kind, 'none')
  assert.equal(previewNarrativeState({ items: [] }).kind, 'none')
})
