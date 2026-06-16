// Honest controls + result freshness tests — Phase 22.2.
// Runs on Node's built-in test runner (`node --test`), no DOM, no extra deps.
//
// Covers:
//   • the control inventory (which controls are active vs disabled "Coming soon",
//     and that the three removed controls are gone from the UI + request wiring),
//   • the pure result-freshness comparator and the banner-visibility rule.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  STYLE_ACTIVE_FIELDS,
  STYLE_COMING_SOON_FIELDS,
  VARIANCE_INCLUDE_FILTERS,
  VARIANCE_IGNORE_FILTERS
} from '../src/lib/uiControls.js'
import { resultFreshness, freshnessBannerVisible } from '../src/lib/generateState.js'

function src(relPath) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8')
}

// --- 1. Honest controls: active vs disabled --------------------------------

test('only Commentary detail is an active Style control', () => {
  assert.deepEqual(STYLE_ACTIVE_FIELDS.map((f) => f.key), ['commentaryDetail'])
})

test('Audience / Report Style / Tone / Length are the disabled "Coming soon" Style controls', () => {
  assert.deepEqual(STYLE_COMING_SOON_FIELDS.map((f) => f.key), ['audience', 'reportStyle', 'tone', 'length'])
})

test('Variance Include/Ignore groups are the disabled "Coming soon" controls', () => {
  assert.deepEqual(VARIANCE_INCLUDE_FILTERS.map((f) => f.key), ['glResearch', 'suggestedCauses', 'questions', 'priorComparison'])
  assert.deepEqual(VARIANCE_IGNORE_FILTERS.map((f) => f.key), ['zeroVariances', 'smallRepeatItems'])
})

test('disabled controls render as non-interactive with a Coming soon tag', () => {
  const stylePanel = src('../src/components/StylePanel.jsx')
  const varianceDetail = src('../src/components/VarianceDetail.jsx')
  // The disabled blocks carry the disabled attribute and the Coming soon tag.
  assert.match(stylePanel, /COMING_SOON_FIELDS\.map[\s\S]*disabled/, 'Style coming-soon selects are disabled')
  assert.match(stylePanel, /coming-soon-tag/, 'Style coming-soon controls are tagged')
  assert.match(varianceDetail, /checkgroup--coming-soon/, 'Variance coming-soon groups are tagged')
  assert.match(varianceDetail, /disabled/, 'Variance coming-soon checkboxes are disabled')
  // No onChange wiring on the coming-soon Variance checkboxes (no fake behavior).
  assert.doesNotMatch(varianceDetail, /toggle\(/, 'coming-soon checkboxes have no toggle handler')
})

// --- 2. Removed controls are absent (UI + state + wiring) ------------------

test('removed controls are gone from the UI', () => {
  const stylePanel = src('../src/components/StylePanel.jsx')
  const varianceDetail = src('../src/components/VarianceDetail.jsx')
  assert.doesNotMatch(stylePanel, /Learn from uploaded reports/i)
  assert.doesNotMatch(stylePanel, /Optional notes/i)
  assert.doesNotMatch(stylePanel, /learnFromUploads/)
  assert.doesNotMatch(varianceDetail, /Narrative Detail/i)
  assert.doesNotMatch(varianceDetail, /narrativeDetail/)
})

test('removed controls are gone from App state and request wiring', () => {
  const app = src('../src/App.jsx')
  // Local state no longer carries the removed fields.
  assert.doesNotMatch(app, /learnFromUploads/)
  assert.doesNotMatch(app, /narrativeDetail/)
  // The free-text notes field is no longer destructured or sent.
  assert.doesNotMatch(app, /form\.append\('notes'/)
  assert.doesNotMatch(app, /const \{ notes/)
})

// --- 3. Result freshness comparator ----------------------------------------

const GEN = { amountThreshold: 1000, percentThreshold: 10, commentaryMode: 'detailed' }

test('identical settings → not stale', () => {
  const f = resultFreshness({ generated: GEN, current: { ...GEN } })
  assert.equal(f.stale, false)
  assert.deepEqual(f.changed, [])
})

test('dollar threshold change → stale (thresholds)', () => {
  const f = resultFreshness({ generated: GEN, current: { ...GEN, amountThreshold: 2500 } })
  assert.equal(f.stale, true)
  assert.deepEqual(f.changed, ['thresholds'])
})

test('percent threshold change → stale (thresholds)', () => {
  const f = resultFreshness({ generated: GEN, current: { ...GEN, percentThreshold: 25 } })
  assert.equal(f.stale, true)
  assert.deepEqual(f.changed, ['thresholds'])
})

test('commentary mode change → stale (commentary)', () => {
  const f = resultFreshness({ generated: GEN, current: { ...GEN, commentaryMode: 'conservative' } })
  assert.equal(f.stale, true)
  assert.deepEqual(f.changed, ['commentary'])
})

test('both changed → stale lists both groups', () => {
  const f = resultFreshness({
    generated: GEN,
    current: { amountThreshold: 2500, percentThreshold: 25, commentaryMode: 'conservative' }
  })
  assert.equal(f.stale, true)
  assert.deepEqual(f.changed, ['thresholds', 'commentary'])
})

test('period scope is NOT tracked — it never makes a result stale', () => {
  // The comparator only sees thresholds + commentary; a period-scope change is
  // not part of its inputs, so an otherwise-identical settings snapshot is fresh.
  const f = resultFreshness({ generated: GEN, current: { ...GEN } })
  assert.equal(f.stale, false)
})

test('missing snapshot or current → treated as not stale', () => {
  assert.deepEqual(resultFreshness({ generated: null, current: GEN }), { stale: false, changed: [] })
  assert.deepEqual(resultFreshness({ generated: GEN, current: null }), { stale: false, changed: [] })
  assert.deepEqual(resultFreshness({}), { stale: false, changed: [] })
})

// --- 4. Banner visibility ---------------------------------------------------

test('banner shows only on a stale success result that is not dismissed', () => {
  assert.equal(freshnessBannerVisible({ status: 'success', hasResult: true, stale: true, dismissed: false }), true)
  assert.equal(freshnessBannerVisible({ status: 'success', hasResult: true, stale: true, dismissed: true }), false)
  assert.equal(freshnessBannerVisible({ status: 'success', hasResult: true, stale: false, dismissed: false }), false)
  assert.equal(freshnessBannerVisible({ status: 'success', hasResult: false, stale: true, dismissed: false }), false)
  assert.equal(freshnessBannerVisible({ status: 'failure', hasResult: true, stale: true, dismissed: false }), false)
  assert.equal(freshnessBannerVisible({}), false)
})
