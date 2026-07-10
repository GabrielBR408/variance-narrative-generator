// QA UX-fix regression tests (pure logic only — no DOM, no extra deps).
// Runs on Node's built-in test runner (`node --test`).
//
// Covers the logic-level pieces of the QA fix batch:
//   • friendlyFileType — raw MIME strings become plain names ("Excel
//     spreadsheet"), with extension / 'File' fallbacks (SourceFiles chips).
//   • enrichmentStatus fallback wording — the api_error catch-all no longer
//     renders the redundant "AI was unavailable (AI temporarily unavailable)";
//     reasons that ADD information (rate limit / circuit breaker) keep their
//     parenthetical. Same dedupe on the export header line.
//   • trackSend — the awaitable analytics send used by the feedback widget:
//     resolves true only on response.ok, false on HTTP error / network failure
//     / timeout, and NEVER rejects (so the widget can await it bare). track()
//     stays fire-and-forget and never throws.

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { friendlyFileType } from '../src/components/uiFormat.js'
import { enrichmentStatus, enrichmentStatusLine } from '../src/lib/enrichmentStatus.js'
import { track, trackSend } from '../src/lib/track.js'

// --- friendlyFileType --------------------------------------------------------

test('friendlyFileType maps the accepted MIME types to plain names', () => {
  assert.equal(
    friendlyFileType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'budget.xlsx'),
    'Excel spreadsheet'
  )
  assert.equal(friendlyFileType('application/vnd.ms-excel', 'gl.xls'), 'Excel spreadsheet')
  assert.equal(friendlyFileType('text/csv', 'gl.csv'), 'CSV')
  assert.equal(friendlyFileType('application/pdf', 'statement.pdf'), 'PDF')
  assert.equal(
    friendlyFileType('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'notes.docx'),
    'Word document'
  )
})

test('friendlyFileType ignores MIME parameters and case', () => {
  assert.equal(friendlyFileType('TEXT/CSV; charset=utf-8', 'gl.csv'), 'CSV')
})

test('friendlyFileType falls back to the extension for unknown MIME types', () => {
  assert.equal(friendlyFileType('text/plain', 'notes.txt'), 'TXT')
  assert.equal(friendlyFileType('', 'archive.zip'), 'ZIP')
  // Known office extensions still get their plain names even with no MIME.
  assert.equal(friendlyFileType('', 'budget.xlsx'), 'Excel spreadsheet')
  assert.equal(friendlyFileType(undefined, 'report.pdf'), 'PDF')
})

test('friendlyFileType returns "File" when there is neither a known MIME nor an extension', () => {
  assert.equal(friendlyFileType('', 'README'), 'File')
  assert.equal(friendlyFileType('application/octet-stream', ''), 'File')
  assert.equal(friendlyFileType(undefined, undefined), 'File')
  // A leading dot is not an extension.
  assert.equal(friendlyFileType('', '.hidden'), 'File')
})

// --- enrichmentStatus fallback wording (dedupe) ------------------------------

// A GL-supported note that was NOT LLM-enriched (zero-enriched fallback).
function fallbackNote(account = 'Repairs & Maintenance') {
  return {
    account,
    varianceAmount: -8500,
    text: `${account} exceeded budget by $8,500.`,
    support: [{ fileName: 'GL.xlsx', classificationType: 'General Ledger (GL)', confidence: 0.9 }]
  }
}

function narrativeWith(notes) {
  return { periods: [{ period: 'current', highVariances: notes }] }
}

test('api_error fallback message no longer duplicates the lead in a parenthetical', () => {
  const s = enrichmentStatus({ narrative: narrativeWith([fallbackNote()]), reason: 'api_error' })
  assert.equal(s.statusKind, 'fallback')
  assert.equal(
    s.message,
    'Basic narrative shown — AI temporarily unavailable. Style settings other than dollar formatting may not apply.'
  )
  // The redundant "AI was unavailable (AI temporarily unavailable)" is gone.
  assert.doesNotMatch(s.message, /unavailable \(AI temporarily unavailable\)/)
})

test('reasons that add information keep their parenthetical', () => {
  const rate = enrichmentStatus({ narrative: narrativeWith([fallbackNote()]), reason: 'rate_limit' })
  assert.match(rate.message, /Basic narrative shown — AI was unavailable \(daily limit reached\)\./)
  const breaker = enrichmentStatus({ narrative: narrativeWith([fallbackNote()]), reason: 'circuit_breaker' })
  assert.match(breaker.message, /Basic narrative shown — AI was unavailable \(daily capacity reached\)\./)
})

test('export header line applies the same dedupe for the api_error catch-all', () => {
  const s = enrichmentStatus({ narrative: narrativeWith([fallbackNote()]), reason: 'api_error' })
  // "Basic narrative (AI unavailable) — AI temporarily unavailable" would
  // repeat itself; the status alone already says everything the reason does.
  assert.equal(enrichmentStatusLine(s), 'Basic narrative (AI unavailable)')
  // Informative reasons still append.
  const rate = enrichmentStatus({ narrative: narrativeWith([fallbackNote()]), reason: 'rate_limit' })
  assert.equal(enrichmentStatusLine(rate), 'Basic narrative (AI unavailable) — daily limit reached')
})

// --- trackSend success/failure contract --------------------------------------

// track.js reads browser globals (window.location, navigator, localStorage) at
// CALL time, so we install minimal stand-ins per test and restore afterwards.
const ORIGINALS = {}

beforeEach(() => {
  ORIGINALS.fetch = globalThis.fetch
  ORIGINALS.window = globalThis.window
  ORIGINALS.localStorage = globalThis.localStorage
  globalThis.window = { location: { pathname: '/vng' } }
  // getSessionId/isInternal degrade gracefully without localStorage/location
  // (their internal try/catch), so only `window` and `navigator` are required.
  if (typeof globalThis.navigator === 'undefined' || !globalThis.navigator.userAgent) {
    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: { userAgent: 'node-test' },
        configurable: true
      })
    } catch {
      // Node ≥21 ships a real navigator with a userAgent — nothing to do.
    }
  }
})

afterEach(() => {
  globalThis.fetch = ORIGINALS.fetch
  globalThis.window = ORIGINALS.window
  globalThis.localStorage = ORIGINALS.localStorage
})

test('trackSend resolves true when the endpoint accepts the row (response.ok)', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 201 })
  assert.equal(await trackSend('vng', 'feedback', { message: 'hi' }), true)
})

test('trackSend resolves false on an HTTP error status', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500 })
  assert.equal(await trackSend('vng', 'feedback', { message: 'hi' }), false)
})

test('trackSend resolves false (never rejects) on a network failure', async () => {
  globalThis.fetch = async () => { throw new TypeError('network down') }
  assert.equal(await trackSend('vng', 'feedback', { message: 'hi' }), false)
})

test('trackSend resolves false once the timeout aborts a hung request', async () => {
  // A fetch that only settles when its abort signal fires — i.e. a hang.
  globalThis.fetch = (url, options) =>
    new Promise((resolve, reject) => {
      if (options && options.signal) {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')))
      }
    })
  assert.equal(
    await trackSend('vng', 'feedback', { message: 'hi' }, { timeoutMs: 25 }),
    false
  )
})

test('trackSend resolves false instead of throwing when the environment is missing', async () => {
  globalThis.fetch = async () => ({ ok: true })
  delete globalThis.window // buildRequest will throw internally
  const result = trackSend('vng', 'feedback', { message: 'hi' })
  assert.ok(result instanceof Promise)
  assert.equal(await result, false)
})

test('track stays fire-and-forget: never throws, even when fetch itself throws', () => {
  globalThis.fetch = () => { throw new Error('boom') }
  assert.doesNotThrow(() => track('vng', 'app_opened'))
  delete globalThis.window
  assert.doesNotThrow(() => track('vng', 'app_opened'))
})
