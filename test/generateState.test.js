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
  GENERATE_LABEL
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
