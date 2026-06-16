// Enrichment diagnostic tests — UI status helper.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
// Pure logic: given extractions + enriched narratives, the helper reports counts
// and one coarse status. It never reads amounts/vendors/rows — only status and
// classification type — so there is nothing sensitive to leak.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { enrichmentDiagnostic, narrativeHasGLEnrichment } from '../src/lib/enrichmentDiagnostic.js'

// Minimal builders mirroring the shapes the app passes in.
const ex = (type, status = 'ok') => ({ status, classification: { type } })
const glNote = { account: 'X', support: [{ classificationType: 'General Ledger (GL)' }] }
const bareNote = { account: 'Y' }
const narrative = (notes) => ({ periods: [{ period: 'current', highVariances: notes }] })

// --- narrativeHasGLEnrichment ---------------------------------------------

test('narrativeHasGLEnrichment is true only when a note carries a GL citation', () => {
  assert.equal(narrativeHasGLEnrichment(narrative([glNote])), true)
  assert.equal(narrativeHasGLEnrichment(narrative([bareNote])), false)
  assert.equal(narrativeHasGLEnrichment(narrative([bareNote, glNote])), true)
  // A non-GL support (e.g. budget) does not count as GL enrichment.
  assert.equal(narrativeHasGLEnrichment(narrative([{ support: [{ classificationType: 'Budget' }] }])), false)
  assert.equal(narrativeHasGLEnrichment(null), false)
  assert.equal(narrativeHasGLEnrichment({ periods: [] }), false)
})

// --- status: no GL ---------------------------------------------------------

test('no GL among supporting files → "No GL supporting file detected"', () => {
  const d = enrichmentDiagnostic({
    extractions: [ex('Base Variance Report'), ex('Budget')],
    narratives: [narrative([bareNote])]
  })
  assert.equal(d.status, 'No GL supporting file detected')
  assert.equal(d.statusKind, 'none')
  assert.equal(d.glDetected, 0)
  assert.equal(d.supportingDetected, 1) // the Budget file (base is excluded)
  assert.equal(d.narrativesEnriched, 0)
  assert.equal(d.narrativesTotal, 1)
})

// --- status: GL uploaded but nothing enriched ------------------------------

test('GL present but no narrative enriched → "GL uploaded but no narratives enriched"', () => {
  const d = enrichmentDiagnostic({
    extractions: [ex('Base Variance Report'), ex('General Ledger (GL)')],
    narratives: [narrative([bareNote])]
  })
  assert.equal(d.status, 'GL uploaded but no narratives enriched')
  assert.equal(d.statusKind, 'pending')
  assert.equal(d.glDetected, 1)
  assert.equal(d.narrativesEnriched, 0)
})

// --- status: enrichment active --------------------------------------------

test('GL present and a narrative enriched → "GL enrichment active"', () => {
  const d = enrichmentDiagnostic({
    extractions: [ex('Base Variance Report'), ex('General Ledger (GL)')],
    narratives: [narrative([glNote, bareNote])]
  })
  assert.equal(d.status, 'GL enrichment active')
  assert.equal(d.statusKind, 'active')
  assert.equal(d.glDetected, 1)
  assert.equal(d.narrativesEnriched, 1)
  assert.equal(d.narrativesTotal, 1)
})

// --- counts: only OK extractions count; multiple files -------------------

test('only OK extractions are counted; GL detection is by classification type', () => {
  const d = enrichmentDiagnostic({
    extractions: [
      ex('Base Variance Report'),
      ex('General Ledger (GL)'),
      ex('gl', 'error'), // not ok → ignored
      ex('Budget'),
      ex('General Ledger (GL)')
    ],
    narratives: [narrative([glNote]), narrative([bareNote])]
  })
  assert.equal(d.glDetected, 2)
  assert.equal(d.supportingDetected, 3) // 2 GL + 1 Budget; base + errored excluded
  assert.equal(d.narrativesEnriched, 1)
  assert.equal(d.narrativesTotal, 2)
  assert.equal(d.status, 'GL enrichment active')
})

// --- determinism & empty input --------------------------------------------

test('empty input is safe and deterministic', () => {
  const a = enrichmentDiagnostic({})
  const b = enrichmentDiagnostic({ extractions: [], narratives: [] })
  assert.deepEqual(a, b)
  assert.equal(a.status, 'No GL supporting file detected')
  assert.equal(a.supportingDetected, 0)
  assert.equal(a.narrativesTotal, 0)
})
