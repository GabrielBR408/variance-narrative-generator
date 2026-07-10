// QA state-fix regression tests.
// Runs on Node's built-in test runner (`node --test`), no DOM, no extra deps.
//
// Pins the pure logic behind the QA fixes:
//   • request identity / mid-generation supersession (a resolved /generate
//     response is discarded when a newer request started or the file set was
//     replaced while it was in flight),
//   • the honest local-fallback notice (fallback because the fetch REJECTED is
//     labeled; a genuine static-host fallback stays silent),
//   • the /api/generate timeout guard (mirrors the OCR client's 90 s abort),
//   • pending-extraction staleness (per-file extraction fingerprints in the
//     result's source snapshot, and the drift comparator),
//   • the freshness banner's value-level re-arm signature (threshold
//     1000 → 2000 (dismiss) → 3000 must re-show the banner).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  fileSetSignature,
  shouldApplyGenerateResponse,
  localFallbackNotice,
  LOCAL_FALLBACK_NOTICE,
  extractionFingerprint,
  sourceExtractionFingerprints,
  extractionFingerprintsDrifted,
  resultFreshness
} from '../src/lib/generateState.js'
import { GENERATE_FETCH_TIMEOUT_MS, GENERATE_TIMEOUT_MESSAGE } from '../src/hooks/useGenerate.js'

// --- 1. Request identity / supersession -------------------------------------

test('fileSetSignature: base + sorted supporting keys, order-insensitive', () => {
  const a = fileSetSignature({ baseKey: 'base.xlsx::1::1', supportingKeys: ['b::2::2', 'a::3::3'] })
  const b = fileSetSignature({ baseKey: 'base.xlsx::1::1', supportingKeys: ['a::3::3', 'b::2::2'] })
  assert.equal(a, b)
  assert.equal(a, 'base.xlsx::1::1|a::3::3|b::2::2')
})

test('fileSetSignature: different base or supporting set → different signature', () => {
  const orig = fileSetSignature({ baseKey: 'base.xlsx::1::1', supportingKeys: ['gl.pdf::2::2'] })
  const swapped = fileSetSignature({ baseKey: 'other.xlsx::9::9', supportingKeys: ['gl.pdf::2::2'] })
  const grown = fileSetSignature({ baseKey: 'base.xlsx::1::1', supportingKeys: ['gl.pdf::2::2', 'budget.xlsx::3::3'] })
  assert.notEqual(orig, swapped)
  assert.notEqual(orig, grown)
})

test('fileSetSignature: tolerates missing inputs (no base, no supporting)', () => {
  assert.equal(fileSetSignature({}), '')
  assert.equal(fileSetSignature(), '')
  assert.equal(fileSetSignature({ baseKey: 'b::1::1' }), 'b::1::1')
})

test('a response is applied only while its request id and file set are both current', () => {
  const key = 'base.xlsx::1::1|gl.pdf::2::2'
  assert.equal(
    shouldApplyGenerateResponse({
      requestId: 1,
      latestRequestId: 1,
      requestFileSetKey: key,
      currentFileSetKey: key
    }),
    true
  )
})

test('a newer request supersedes an in-flight one → discard its response', () => {
  const key = 'base.xlsx::1::1'
  assert.equal(
    shouldApplyGenerateResponse({
      requestId: 1,
      latestRequestId: 2, // a second generate() started before this one resolved
      requestFileSetKey: key,
      currentFileSetKey: key
    }),
    false
  )
})

test('replacing the base file mid-flight supersedes the request → discard', () => {
  assert.equal(
    shouldApplyGenerateResponse({
      requestId: 3,
      latestRequestId: 3, // no newer request — only the files changed
      requestFileSetKey: 'old-base.xlsx::1::1|gl.pdf::2::2',
      currentFileSetKey: 'new-base.xlsx::9::9|gl.pdf::2::2'
    }),
    false
  )
})

// --- 2. Honest local-fallback notice -----------------------------------------

test('fallback after a REJECTED fetch (server unreachable) carries the notice', () => {
  const notice = localFallbackNotice({ usedFallback: true, fetchRejected: true })
  assert.equal(notice, LOCAL_FALLBACK_NOTICE)
  // The copy must say what happened plainly: generated locally, no AI, server
  // unreachable, style settings beyond dollar formatting may not apply.
  assert.match(notice, /generated locally/i)
  assert.match(notice, /without AI commentary/i)
  assert.match(notice, /could not be reached/i)
  assert.match(notice, /dollar formatting/i)
})

test('a genuine static-host fallback (404/405 or SPA shell, no rejection) stays silent', () => {
  assert.equal(localFallbackNotice({ usedFallback: true, fetchRejected: false }), null)
})

test('no fallback at all → no notice (whatever happened to the fetch)', () => {
  assert.equal(localFallbackNotice({ usedFallback: false, fetchRejected: true }), null)
  assert.equal(localFallbackNotice({ usedFallback: false, fetchRejected: false }), null)
  assert.equal(localFallbackNotice(), null)
})

// --- 3. Generate timeout guard ------------------------------------------------

test('the /api/generate timeout mirrors the OCR client (90 s) with a friendly message', () => {
  // src/lib/ocr/ocrClient.js OCR_FETCH_TIMEOUT_MS is 90000; the generate path
  // must match so a stalled request can never spin forever.
  assert.equal(GENERATE_FETCH_TIMEOUT_MS, 90000)
  assert.equal(typeof GENERATE_TIMEOUT_MESSAGE, 'string')
  assert.match(GENERATE_TIMEOUT_MESSAGE, /too long/i)
  assert.match(GENERATE_TIMEOUT_MESSAGE, /try again/i)
})

// --- 4. Extraction fingerprints (pending-extraction staleness) ----------------

test('extractionFingerprint captures status + normalized row count', () => {
  assert.equal(extractionFingerprint(null), 'missing')
  assert.equal(extractionFingerprint(undefined), 'missing')
  assert.equal(extractionFingerprint({ status: 'pending' }), 'pending::0')
  assert.equal(
    extractionFingerprint({ status: 'ok', normalized: { rows: [['a'], ['b'], ['c']] } }),
    'ok::3'
  )
  // Same status, different row count → different fingerprint (re-extraction).
  assert.notEqual(
    extractionFingerprint({ status: 'ok', normalized: { rows: [] } }),
    extractionFingerprint({ status: 'ok', normalized: { rows: [['a']] } })
  )
})

test('sourceExtractionFingerprints maps every source key from the extraction map', () => {
  const extractions = {
    'base.xlsx::1::1': { status: 'ok', normalized: { rows: [['a'], ['b']] } },
    'gl.pdf::2::2': { status: 'pending' }
  }
  const fp = sourceExtractionFingerprints({
    baseKey: 'base.xlsx::1::1',
    supportingKeys: ['gl.pdf::2::2', 'budget.xlsx::3::3'], // budget never registered
    extractions
  })
  assert.deepEqual(fp, {
    'base.xlsx::1::1': 'ok::2',
    'gl.pdf::2::2': 'pending::0',
    'budget.xlsx::3::3': 'missing'
  })
})

test('a supporting file finishing extraction after generation is a drift', () => {
  const atGenerate = { 'base::1::1': 'ok::10', 'gl::2::2': 'pending::0' }
  const afterFinish = { 'base::1::1': 'ok::10', 'gl::2::2': 'ok::40' }
  assert.equal(extractionFingerprintsDrifted(atGenerate, afterFinish), true)
  // Identical maps → no drift; missing inputs → no drift.
  assert.equal(extractionFingerprintsDrifted(atGenerate, { ...atGenerate }), false)
  assert.equal(extractionFingerprintsDrifted({}, {}), false)
  assert.equal(extractionFingerprintsDrifted(null, null), false)
})

test('a key present on only one side is a drift (file added/removed from the map)', () => {
  assert.equal(extractionFingerprintsDrifted({ 'a::1::1': 'ok::1' }, {}), true)
  assert.equal(extractionFingerprintsDrifted({}, { 'a::1::1': 'ok::1' }), true)
})

// --- 5. extractionStale surfaces through resultFreshness as 'files' -----------

// The settings + source snapshot shape App spreads into `generated`
// ({ ...result.settings, ...result.source }).
const SNAP = {
  amountThreshold: 1000,
  percentThreshold: 10,
  commentaryMode: 'detailed',
  baseKey: 'base.xlsx::1::1',
  supportingKeys: ['gl.pdf::2::2'],
  extractionFingerprints: { 'base.xlsx::1::1': 'ok::10', 'gl.pdf::2::2': 'pending::0' }
}

test('an extraction-stale snapshot marks the result stale under the files group', () => {
  const f = resultFreshness({ generated: { ...SNAP, extractionStale: true }, current: { ...SNAP } })
  assert.equal(f.stale, true)
  assert.deepEqual(f.changed, ['files'])
})

test('extractionStale never double-reports files when the keys also changed', () => {
  const f = resultFreshness({
    generated: { ...SNAP, extractionStale: true },
    current: { ...SNAP, supportingKeys: [] }
  })
  assert.equal(f.stale, true)
  assert.deepEqual(f.changed, ['files'])
})

test('without the stale mark, unchanged keys stay fresh (fingerprints alone are inert)', () => {
  const f = resultFreshness({ generated: { ...SNAP }, current: { ...SNAP } })
  assert.equal(f.stale, false)
  assert.deepEqual(f.changed, [])
})

// --- 6. Freshness banner re-arm signature -------------------------------------

test('same inputs → same signature (stable, deterministic)', () => {
  const a = resultFreshness({ generated: { ...SNAP }, current: { ...SNAP } })
  const b = resultFreshness({ generated: { ...SNAP }, current: { ...SNAP } })
  assert.equal(typeof a.signature, 'string')
  assert.equal(a.signature, b.signature)
})

test('threshold 1000 → 2000 (dismiss) → 3000 changes the signature both times', () => {
  // Both drifts produce the SAME changed group list ('thresholds') — the old
  // group-name key never re-armed the dismissed banner. The value-level
  // signature must differ between the 2000 and 3000 states.
  const at2000 = resultFreshness({ generated: { ...SNAP }, current: { ...SNAP, amountThreshold: 2000 } })
  const at3000 = resultFreshness({ generated: { ...SNAP }, current: { ...SNAP, amountThreshold: 3000 } })
  assert.deepEqual(at2000.changed, ['thresholds'])
  assert.deepEqual(at3000.changed, ['thresholds'])
  assert.notEqual(at2000.signature, at3000.signature)
})

test('post-dismissal extraction drift re-arms too (fingerprints ride the signature)', () => {
  const before = resultFreshness({
    generated: { ...SNAP, extractionStale: true },
    current: { ...SNAP }
  })
  // The drift effect rewrites the snapshot's fingerprints when marking it stale.
  const after = resultFreshness({
    generated: {
      ...SNAP,
      extractionStale: true,
      extractionFingerprints: { 'base.xlsx::1::1': 'ok::10', 'gl.pdf::2::2': 'ok::40' }
    },
    current: { ...SNAP }
  })
  assert.notEqual(before.signature, after.signature)
})

test('missing inputs keep the exact legacy shape (no signature)', () => {
  // Pinned elsewhere with deepEqual — the early return must stay byte-compatible.
  assert.deepEqual(resultFreshness({}), { stale: false, changed: [] })
  assert.equal(resultFreshness({}).signature, undefined)
})
