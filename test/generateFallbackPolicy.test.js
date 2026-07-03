// Generate fallback-policy tests — review-pass fix.
// Runs on Node's built-in test runner (`node --test`), no DOM, no extra deps.
//
// The generate flow may hand off to the in-browser clientGenerate ONLY when the
// /api/generate endpoint is genuinely absent (network error, or a 404/405 from a
// static host). Any other non-ok status is a REAL server failing — previously a
// 413 (oversized multipart body) or an HTML 500 page threw in res.json() and was
// silently rerouted to clientGenerate, which reported SUCCESS with a LOCAL- job
// id and a basic narrative instead of an actionable error. These pin the pure
// policy helpers in src/hooks/useGenerate.js.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { shouldClientFallback, serverFailureMessage } from '../src/hooks/useGenerate.js'

// --- When the fallback is allowed -------------------------------------------

test('no response at all (fetch rejected / no server) → fall back', () => {
  assert.equal(shouldClientFallback(null), true)
  assert.equal(shouldClientFallback(undefined), true)
})

test('404/405 (static host, endpoint absent) → fall back', () => {
  assert.equal(shouldClientFallback({ ok: false, status: 404 }), true)
  assert.equal(shouldClientFallback({ ok: false, status: 405 }), true)
})

// --- When the server is authoritative ----------------------------------------

test('413 and 5xx are real server failures — never fall back', () => {
  for (const status of [413, 500, 502, 503]) {
    assert.equal(shouldClientFallback({ ok: false, status }), false, `expected no fallback for ${status}`)
  }
})

test('structured server errors (400) stay authoritative — never fall back', () => {
  assert.equal(shouldClientFallback({ ok: false, status: 400 }), false)
})

test('a successful response is handled by the server path, not the fallback', () => {
  assert.equal(shouldClientFallback({ ok: true, status: 200 }), false)
})

// --- Actionable failure messages ----------------------------------------------

test('413 surfaces a files-too-large message the user can act on', () => {
  const msg = serverFailureMessage(413)
  assert.match(msg, /too large/i)
  assert.match(msg, /remove or shrink/i)
})

test('other server failures name the status and invite a retry', () => {
  const msg = serverFailureMessage(500)
  assert.match(msg, /HTTP 500/)
  assert.match(msg, /try again/i)
})
