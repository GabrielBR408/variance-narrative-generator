// Unified upload routing tests — Phase C.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Exercises routeUpload / isBaseCandidate: how a single dropped batch is split
// into the base variance report vs. supporting files, that only one base is ever
// held, that a clear variance-named file replaces an existing base (with notice),
// and that the helper is pure. Routing relies on the existing filename classifier
// (src/lib/classify.js), which these tests treat as a fixed dependency.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { routeUpload, isBaseCandidate } from '../src/lib/uploadRouting.js'

// Minimal stand-in for a browser File — routing reads only `.name`.
function f(name) {
  return { name, size: 1, lastModified: 0 }
}

test('isBaseCandidate recognises a variance-named file and rejects others', () => {
  assert.equal(isBaseCandidate(f('2026-05 Variance Report.xlsx')), true)
  assert.equal(isBaseCandidate(f('General Ledger.csv')), false)
  assert.equal(isBaseCandidate(f('income statement.xlsx')), false)
})

test('first batch: a variance-named file becomes the base, the rest supporting', () => {
  const r = routeUpload({
    incoming: [f('General Ledger.csv'), f('May Variance Report.xlsx'), f('Budget.xlsx')],
    currentBase: null,
    currentSupporting: []
  })
  assert.equal(r.base.name, 'May Variance Report.xlsx')
  assert.deepEqual(r.supporting.map((x) => x.name), ['General Ledger.csv', 'Budget.xlsx'])
  assert.equal(r.addedSupporting, 2)
  assert.equal(r.baseReplaced, false)
  assert.match(r.notice, /Identified .*May Variance Report\.xlsx.* as the base/)
})

test('no variance name + no base: an unclassified file is preferred as base over a known GL', () => {
  const r = routeUpload({
    incoming: [f('General Ledger.csv'), f('income statement.xlsx')],
    currentBase: null,
    currentSupporting: []
  })
  // income statement matches no supporting keyword (generic) → more likely the base.
  assert.equal(r.base.name, 'income statement.xlsx')
  assert.deepEqual(r.supporting.map((x) => x.name), ['General Ledger.csv'])
})

test('no variance name + no base + only known supporting types: first file lands as base', () => {
  const r = routeUpload({
    incoming: [f('General Ledger.csv'), f('Budget.xlsx')],
    currentBase: null,
    currentSupporting: []
  })
  assert.equal(r.base.name, 'General Ledger.csv')
  assert.deepEqual(r.supporting.map((x) => x.name), ['Budget.xlsx'])
})

test('with a base already set, an ambiguous batch never displaces it — all go to supporting', () => {
  const base = f('Q1 Variance Report.xlsx')
  const r = routeUpload({
    incoming: [f('General Ledger.csv'), f('Budget.xlsx')],
    currentBase: base,
    currentSupporting: [f('Existing GL.csv')]
  })
  assert.equal(r.base, base)
  assert.equal(r.baseReplaced, false)
  assert.deepEqual(r.supporting.map((x) => x.name), ['Existing GL.csv', 'General Ledger.csv', 'Budget.xlsx'])
  assert.equal(r.addedSupporting, 2)
  assert.match(r.notice, /Added 2 supporting files/)
})

test('a second variance-named file replaces the first base and reports it', () => {
  const base = f('Old Variance Report.xlsx')
  const r = routeUpload({
    incoming: [f('New Variance Report.xlsx')],
    currentBase: base,
    currentSupporting: []
  })
  assert.equal(r.base.name, 'New Variance Report.xlsx')
  assert.equal(r.baseReplaced, true)
  // The replaced base is dropped, not demoted to supporting.
  assert.deepEqual(r.supporting.map((x) => x.name), [])
  assert.match(r.notice, /Replaced the base variance report.*New Variance Report\.xlsx/)
})

test('only one base survives when a batch carries several variance reports', () => {
  const r = routeUpload({
    incoming: [f('Variance A.xlsx'), f('Variance B.xlsx'), f('GL.csv')],
    currentBase: null,
    currentSupporting: []
  })
  // Exactly one base; the other variance file is treated as supporting.
  const supportingNames = r.supporting.map((x) => x.name)
  assert.equal([r.base.name, ...supportingNames].filter((n) => n.startsWith('Variance')).length, 2)
  assert.equal(supportingNames.includes('GL.csv'), true)
  assert.ok(!supportingNames.includes(r.base.name))
})

test('singular wording for a single supporting file', () => {
  const r = routeUpload({
    incoming: [f('GL.csv')],
    currentBase: f('Variance.xlsx'),
    currentSupporting: []
  })
  assert.match(r.notice, /Added 1 supporting file\b/)
  assert.doesNotMatch(r.notice, /1 supporting files/)
})

test('empty batch is a no-op that preserves current state', () => {
  const base = f('Variance.xlsx')
  const support = [f('GL.csv')]
  const r = routeUpload({ incoming: [], currentBase: base, currentSupporting: support })
  assert.equal(r.base, base)
  assert.equal(r.supporting, support)
  assert.equal(r.notice, '')
  assert.equal(r.addedSupporting, 0)
})

test('routeUpload is pure — it never mutates the arrays it is given', () => {
  const support = [f('GL.csv')]
  routeUpload({ incoming: [f('Budget.xlsx')], currentBase: f('Variance.xlsx'), currentSupporting: support })
  assert.deepEqual(support.map((x) => x.name), ['GL.csv'])
})
