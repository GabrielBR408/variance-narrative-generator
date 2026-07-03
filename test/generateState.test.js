// Generate-flow UI state tests — Phase 9C.
// Runs on Node's built-in test runner (`node --test`), no DOM, no extra deps.
// Covers the deterministic readiness / loading / error / button view-model that
// drives the Generate experience (src/lib/generateState.js).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  extractionReadiness,
  generateButtonState,
  generateHint,
  isBusy,
  GENERATE_LABEL,
  AI_LLM_MODE,
  generateClickAction,
  resultFreshness,
  shouldClearFailure
} from '../src/lib/generateState.js'

const okExtraction = { fileId: 'f1', fileName: 'base.pdf', status: 'ok', confidence: 90 }

// --- Readiness ------------------------------------------------------------

test('no base report → not ready (no-base)', () => {
  const r = extractionReadiness({ hasBase: false, baseExtraction: null })
  assert.equal(r.ready, false)
  assert.equal(r.reason, 'no-base')
  assert.match(r.message, /base variance report/i)
})

test('base still extracting → not ready (extracting)', () => {
  const pending = extractionReadiness({ hasBase: true, baseExtraction: { status: 'pending' } })
  assert.equal(pending.ready, false)
  assert.equal(pending.reason, 'extracting')

  // No record yet (effect hasn't written the pending placeholder) is also "extracting".
  const none = extractionReadiness({ hasBase: true, baseExtraction: undefined })
  assert.equal(none.ready, false)
  assert.equal(none.reason, 'extracting')
})

test('base extraction failed/empty/unavailable → not ready (extract-failed) with friendly detail', () => {
  for (const status of ['error', 'empty', 'unavailable']) {
    const r = extractionReadiness({
      hasBase: true,
      baseExtraction: { status, message: 'This file appears to be empty.' }
    })
    assert.equal(r.ready, false)
    assert.equal(r.reason, 'extract-failed')
    assert.equal(r.message, 'This file appears to be empty.')
  }
})

test('base extracted ok → ready', () => {
  const r = extractionReadiness({ hasBase: true, baseExtraction: okExtraction })
  assert.equal(r.ready, true)
  assert.equal(r.reason, 'ready')
})

// --- Disabled / loading button state --------------------------------------

test('button is disabled until the base is ready', () => {
  const notReady = generateButtonState({
    status: 'idle',
    readiness: extractionReadiness({ hasBase: true, baseExtraction: { status: 'pending' } })
  })
  assert.equal(notReady.disabled, true)
  assert.equal(notReady.busy, false)

  const ready = generateButtonState({
    status: 'idle',
    readiness: extractionReadiness({ hasBase: true, baseExtraction: okExtraction })
  })
  assert.equal(ready.disabled, false)
  assert.equal(ready.label, GENERATE_LABEL.idle)
})

test('loading state: busy disables the button and shows progress labels', () => {
  const ready = extractionReadiness({ hasBase: true, baseExtraction: okExtraction })

  assert.equal(isBusy('preparing'), true)
  assert.equal(isBusy('sending'), true)
  assert.equal(isBusy('idle'), false)

  for (const status of ['preparing', 'sending']) {
    const b = generateButtonState({ status, readiness: ready })
    assert.equal(b.busy, true)
    assert.equal(b.disabled, true, `expected disabled while ${status}`)
    assert.equal(b.label, GENERATE_LABEL[status])
  }
})

test('after success the button invites a regenerate (still gated on readiness)', () => {
  const ready = extractionReadiness({ hasBase: true, baseExtraction: okExtraction })
  const b = generateButtonState({ status: 'success', readiness: ready })
  assert.equal(b.disabled, false)
  assert.equal(b.label, GENERATE_LABEL.success)
})

// --- Hint / error rendering ----------------------------------------------

test('error rendering: a failed generate surfaces the error message', () => {
  const ready = extractionReadiness({ hasBase: true, baseExtraction: okExtraction })
  const hint = generateHint({ status: 'failure', message: 'Generation could not be completed. Try again.', readiness: ready })
  assert.equal(hint.tone, 'error')
  assert.match(hint.text, /could not be completed/i)
})

test('hint: extraction-in-progress shows an info note, extraction-failed shows an error', () => {
  const extracting = generateHint({
    status: 'idle',
    readiness: extractionReadiness({ hasBase: true, baseExtraction: { status: 'pending' } })
  })
  assert.equal(extracting.tone, 'info')
  assert.match(extracting.text, /reading your base report/i)

  const failed = generateHint({
    status: 'idle',
    readiness: extractionReadiness({ hasBase: true, baseExtraction: { status: 'error', message: 'This file looks corrupt or unreadable.' } })
  })
  assert.equal(failed.tone, 'error')
  assert.equal(failed.text, 'This file looks corrupt or unreadable.')
})

test('hint stays silent at the very start (no base) — disabled button is enough', () => {
  const hint = generateHint({
    status: 'idle',
    readiness: extractionReadiness({ hasBase: false, baseExtraction: null })
  })
  assert.equal(hint, null)
})

test('successful generate flow: ready + idle yields an enabled button and no hint', () => {
  const readiness = extractionReadiness({ hasBase: true, baseExtraction: okExtraction })
  const button = generateButtonState({ status: 'idle', readiness })
  const hint = generateHint({ status: 'success', message: '', readiness })
  assert.equal(button.disabled, false)
  assert.equal(hint, null)
})

// --- UX-1: always-AI Generate + disclosure gating -------------------------

test('AI_LLM_MODE is the single cited mode sent to the server', () => {
  assert.equal(AI_LLM_MODE, 'cited')
})

test('Generate click shows the disclosure on first use (not yet acknowledged)', () => {
  assert.equal(generateClickAction({ acknowledged: false, busy: false }), 'disclose')
})

test('Generate click proceeds immediately once the disclosure is acknowledged', () => {
  assert.equal(generateClickAction({ acknowledged: true, busy: false }), 'generate')
})

test('Generate click is a no-op while a request is in flight (either ack state)', () => {
  assert.equal(generateClickAction({ acknowledged: true, busy: true }), 'noop')
  assert.equal(generateClickAction({ acknowledged: false, busy: true }), 'noop')
})

test('generateClickAction defaults to the disclosure when called with no args', () => {
  assert.equal(generateClickAction(), 'disclose')
})

// --- Result freshness: the full effective style is tracked -----------------

// Snapshot carrying every output-shaping input: thresholds, commentary mode,
// and the five Style-panel fields (all of them change the generated narrative,
// abbreviation included — it is baked in at generate time).
const STYLE_SNAP = {
  amountThreshold: 1000,
  percentThreshold: 10,
  commentaryMode: 'detailed',
  reportStyle: 'Detailed',
  tone: 'Neutral',
  length: 'Standard',
  abbreviateDollars: false,
  dollarReferences: 'Detail'
}

test('identical style snapshot → not stale', () => {
  const f = resultFreshness({ generated: STYLE_SNAP, current: { ...STYLE_SNAP } })
  assert.equal(f.stale, false)
  assert.deepEqual(f.changed, [])
})

test('each Style field change marks the result stale (style)', () => {
  const drifts = [
    { tone: 'Cautious' },
    { length: 'Verbose' },
    { abbreviateDollars: true },
    { dollarReferences: 'Minimum' }
  ]
  for (const drift of drifts) {
    const f = resultFreshness({ generated: STYLE_SNAP, current: { ...STYLE_SNAP, ...drift } })
    assert.equal(f.stale, true, `expected stale for ${JSON.stringify(drift)}`)
    assert.deepEqual(f.changed, ['style'])
  }
})

test('a Report Style change trips both commentary and style (mode derives from it)', () => {
  const f = resultFreshness({
    generated: STYLE_SNAP,
    current: { ...STYLE_SNAP, reportStyle: 'Concise', commentaryMode: 'conservative' }
  })
  assert.equal(f.stale, true)
  assert.deepEqual(f.changed, ['commentary', 'style'])
})

test('snapshots without style fields never flag style (back-compat)', () => {
  const legacy = { amountThreshold: 1000, percentThreshold: 10, commentaryMode: 'detailed' }
  const f = resultFreshness({
    generated: legacy,
    current: { ...legacy, tone: 'Cautious', abbreviateDollars: true }
  })
  assert.equal(f.stale, false)
  assert.deepEqual(f.changed, [])
})

// --- Failure reset: changing files clears a stale failure alert ------------

test('a lingering failure clears once the file set changes', () => {
  assert.equal(shouldClearFailure({ status: 'failure', filesChanged: true }), true)
})

test('a failure stays while the file set that caused it is unchanged', () => {
  assert.equal(shouldClearFailure({ status: 'failure', filesChanged: false }), false)
})

test('non-failure statuses are never cleared by a file change', () => {
  for (const status of ['idle', 'preparing', 'sending', 'success']) {
    assert.equal(shouldClearFailure({ status, filesChanged: true }), false)
  }
  assert.equal(shouldClearFailure(), false)
})
