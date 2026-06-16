// Narrative preview routing tests — Phase 21.5.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// The live Narrative Preview must MIRROR the generate path: exactly ONE narrative
// built from the Base Variance Report and enriched with the supporting files. A
// supporting file (GL, budget, …) must NOT produce its own standalone preview
// narrative, and with no base there is no preview. These tests pin that routing
// at the pure-logic layer (src/lib/previewNarrative) the React component renders.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildPreviewNarrative, findBaseExtraction, BASE_TYPE } from '../src/lib/previewNarrative.js'
import { enrichmentDiagnostic } from '../src/lib/enrichmentDiagnostic.js'
import { computeVariance } from '../src/lib/variance/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'

// --- fixtures: extraction objects shaped like the browser's normalized output -

// A base variance report with one strongly flagged expense line (Utility Expense
// Recovery: 12,700 actual vs 5,334 budget → +7,366, well over threshold).
function baseExtraction(overrides = {}) {
  return {
    fileId: 'base',
    fileName: 'Comparative Income Statement.xlsx',
    status: 'ok',
    confidence: 90,
    classification: { type: BASE_TYPE },
    normalized: {
      columns: ['Account', 'Actual', 'Budget'],
      rows: [
        ['Utility Expense Recovery', '12700', '5334'],
        ['Office Supplies', '120', '110']
      ],
      accounts: [],
      dates: [],
      values: []
    },
    ...overrides
  }
}

// A two-period base (Current + YTD) so the period-scope narrowing is exercised.
function twoPeriodBase() {
  return baseExtraction({
    normalized: {
      columns: [
        'Account',
        'Current Actual', 'Current Budget',
        'YTD Actual', 'YTD Budget'
      ],
      rows: [
        ['Utility Expense Recovery', '12700', '5334', '120000', '60000']
      ],
      accounts: [], dates: [], values: []
    }
  })
}

// A GL supporting file that matches the flagged account.
function glExtraction(overrides = {}) {
  return {
    fileId: 'gl',
    fileName: 'General Ledger.pdf',
    status: 'ok',
    confidence: 90,
    classification: { type: 'General Ledger (GL)' },
    normalized: {
      columns: ['Account', 'Amount'],
      rows: [
        ['Utility Expense Recovery', '7366'],
        ['Office Supplies', '120']
      ],
      accounts: [], dates: [], values: []
    },
    ...overrides
  }
}

function highVarianceAccounts(narrative) {
  return (narrative.periods || []).flatMap((p) =>
    (p.highVariances || []).map((n) => n.account)
  )
}

// --- preview renders the base only -----------------------------------------

test('preview builds exactly one narrative, from the Base Variance Report', () => {
  const narrative = buildPreviewNarrative({ items: [baseExtraction()] })
  assert.ok(narrative, 'a base report yields a preview narrative')
  assert.equal(narrative.fileId, 'base')
  assert.equal(narrative.fileName, 'Comparative Income Statement.xlsx')
  // The flagged account is present (the base report's own variance).
  assert.ok(highVarianceAccounts(narrative).includes('Utility Expense Recovery'))
})

test('preview narrative equals the generate route applied to the base', () => {
  // Same deterministic route the App generate flow runs over the base extraction.
  const base = baseExtraction()
  const expected = enrichNarrative(
    generateNarrative(computeVariance(base)),
    { supporting: [], mode: 'conservative' }
  )
  const preview = buildPreviewNarrative({ items: [base] })
  assert.deepEqual(preview, expected)
})

// --- supporting files enrich the base, never stand alone -------------------

test('a GL supporting file enriches the base note (no standalone GL narrative)', () => {
  const items = [baseExtraction(), glExtraction()]
  const narrative = buildPreviewNarrative({ items })

  // Still ONE narrative — the base's — never one per file.
  assert.equal(narrative.fileId, 'base')

  // The base's flagged note now carries GL evidence.
  const note = narrative.periods[0].highVariances.find(
    (n) => n.account === 'Utility Expense Recovery'
  )
  assert.ok(note.enriched, 'the base note is enriched by the GL file')
  assert.ok(
    note.support.some((s) => /general\s*ledger|\bgl\b/i.test(s.classificationType)),
    'enrichment carries a GL citation'
  )
  // The GL file never appears as its own preview narrative (no GL fileId/name).
  assert.notEqual(narrative.fileId, 'gl')
  assert.doesNotMatch(narrative.fileName, /General Ledger\.pdf/)
})

test('a GL file with no base produces NO preview narrative', () => {
  // Only a GL file uploaded, no Base Variance Report → nothing to preview.
  assert.equal(buildPreviewNarrative({ items: [glExtraction()] }), null)
})

test('no items / empty / no base all yield no preview', () => {
  assert.equal(buildPreviewNarrative({ items: [] }), null)
  assert.equal(buildPreviewNarrative({}), null)
  assert.equal(
    buildPreviewNarrative({ items: [glExtraction(), { status: 'ok', classification: { type: 'Budget' }, normalized: { columns: [], rows: [] } }] }),
    null
  )
})

test('findBaseExtraction picks the base report and ignores non-ok files', () => {
  const items = [glExtraction(), baseExtraction(), baseExtraction({ fileId: 'b2', status: 'error' })]
  assert.equal(findBaseExtraction(items).fileId, 'base')
  assert.equal(findBaseExtraction([glExtraction()]), null)
})

// --- diagnostics unchanged --------------------------------------------------

test('diagnostics report GL enrichment active for the single base narrative', () => {
  const items = [baseExtraction(), glExtraction()]
  const narrative = buildPreviewNarrative({ items })
  const d = enrichmentDiagnostic({ extractions: items, narratives: [narrative] })
  assert.equal(d.status, 'GL enrichment active')
  assert.equal(d.glDetected, 1)
  assert.equal(d.supportingDetected, 1) // GL only; base excluded
  assert.equal(d.narrativesTotal, 1) // exactly one narrative now
  assert.equal(d.narrativesEnriched, 1)
})

test('diagnostic counts are identical whether or not the base is in the extraction list', () => {
  // The generate path passes only supporting extractions to the diagnostic; the
  // preview passes the full item list. Both must yield the same numbers, since
  // the base is never GL and is excluded from the supporting count.
  const base = baseExtraction()
  const gl = glExtraction()
  const narrative = buildPreviewNarrative({ items: [base, gl] })
  const withBase = enrichmentDiagnostic({ extractions: [base, gl], narratives: [narrative] })
  const supportingOnly = enrichmentDiagnostic({ extractions: [gl], narratives: [narrative] })
  assert.deepEqual(withBase, supportingOnly)
})

// --- period scope still narrows the preview --------------------------------

test('period scope narrows a two-period base preview', () => {
  const items = [twoPeriodBase()]
  const both = buildPreviewNarrative({ items, periodScope: 'both' })
  assert.deepEqual(both.periods.map((p) => p.period), ['current', 'ytd'])

  const current = buildPreviewNarrative({ items, periodScope: 'current' })
  assert.deepEqual(current.periods.map((p) => p.period), ['current'])

  const ytd = buildPreviewNarrative({ items, periodScope: 'ytd' })
  assert.deepEqual(ytd.periods.map((p) => p.period), ['ytd'])
})

// --- determinism ------------------------------------------------------------

test('buildPreviewNarrative is deterministic for the same inputs', () => {
  const items = [baseExtraction(), glExtraction()]
  assert.deepEqual(buildPreviewNarrative({ items }), buildPreviewNarrative({ items }))
})
