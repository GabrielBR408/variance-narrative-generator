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

test('the five Style controls are all active (Phase 23)', () => {
  assert.deepEqual(
    STYLE_ACTIVE_FIELDS.map((f) => f.key),
    ['reportStyle', 'tone', 'length', 'abbreviateDollars', 'dollarReferences']
  )
})

test('no Style controls are deferred ("Coming soon") anymore', () => {
  assert.deepEqual(STYLE_COMING_SOON_FIELDS, [])
})

test('Abbreviate Dollar Values is a toggle, the rest are selects', () => {
  const byKey = Object.fromEntries(STYLE_ACTIVE_FIELDS.map((f) => [f.key, f]))
  assert.equal(byKey.abbreviateDollars.type, 'toggle')
  assert.equal(byKey.reportStyle.type, 'select')
  assert.deepEqual(byKey.reportStyle.options, ['Concise', 'Detailed'])
  assert.deepEqual(byKey.tone.options, ['Neutral', 'Cautious'])
  assert.deepEqual(byKey.length.options, ['Brief', 'Standard', 'Verbose'])
  assert.deepEqual(byKey.dollarReferences.options, ['Minimum', 'Detail'])
})

test('Variance Include/Ignore groups are the disabled "Coming soon" controls', () => {
  assert.deepEqual(VARIANCE_INCLUDE_FILTERS.map((f) => f.key), ['glResearch', 'suggestedCauses', 'questions', 'priorComparison'])
  assert.deepEqual(VARIANCE_IGNORE_FILTERS.map((f) => f.key), ['zeroVariances', 'smallRepeatItems'])
})

test('the Style panel renders an active checkbox toggle and no Coming soon tag', () => {
  const stylePanel = src('../src/components/StylePanel.jsx')
  // The toggle control renders as a checkbox input, not a disabled dropdown.
  assert.match(stylePanel, /type="checkbox"/, 'Abbreviate Dollar Values renders as a checkbox')
  // No Style control is disabled or tagged "Coming soon" anymore.
  assert.doesNotMatch(stylePanel, /coming-soon-tag/, 'no Coming soon tags remain in the Style panel')
  assert.doesNotMatch(stylePanel, /disabled/, 'no Style control is disabled')
})

test('the Variance coming-soon groups stay non-interactive with a Coming soon tag', () => {
  const varianceDetail = src('../src/components/VarianceDetail.jsx')
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
  // Phase 23: Audience and the old "Commentary detail" control were removed.
  assert.doesNotMatch(stylePanel, /Audience/i)
  assert.doesNotMatch(stylePanel, /Commentary detail/i)
  assert.doesNotMatch(varianceDetail, /Narrative Detail/i)
  assert.doesNotMatch(varianceDetail, /narrativeDetail/)
})

test('removed controls are gone from App state and request wiring', () => {
  const app = src('../src/App.jsx')
  // Local state no longer carries the removed fields.
  assert.doesNotMatch(app, /learnFromUploads/)
  assert.doesNotMatch(app, /narrativeDetail/)
  // Phase 23: Audience and Commentary detail are no longer part of DEFAULT_STYLE.
  assert.doesNotMatch(app, /audience:/)
  assert.doesNotMatch(app, /commentaryDetail:/)
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
