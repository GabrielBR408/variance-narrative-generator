// Static-fallback parity tests — UI-testing build.
// Runs on Node's built-in test runner (`node --test`), no DOM, no extra deps.
//
// The browser-side generate fallback (src/lib/clientGenerate.js) must produce the
// SAME variance + narrative + extraction the server (server/generate.js) returns
// for the same base report, so a static GitHub Pages build behaves identically to
// a server-backed deploy.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { clientGenerate } from '../src/lib/clientGenerate.js'
import { buildGenerateResponse } from '../server/generate.js'
import { thresholdsFromSettings } from '../src/lib/variance/thresholds.js'

function baseExtraction() {
  return {
    fileId: 'base',
    fileName: 'Income Statement.xlsx',
    status: 'ok',
    confidence: 90,
    classification: { type: 'Base Variance Report' },
    normalized: {
      columns: ['Account', 'Actual', 'Budget'],
      rows: [
        ['Repairs & Maintenance', '5000', '1000'],
        ['Office Supplies', '520', '500'],
        ['Rental Income', '300', '']
      ],
      accounts: [], dates: [], values: []
    }
  }
}

const FILES = [{ name: 'Income Statement.xlsx', size: 10, type: '', role: 'baseReport' }]

test('client fallback matches the server variance + narrative + extraction', async () => {
  const base = baseExtraction()
  const variance = { dollarThreshold: '1000', percentThreshold: '10' }
  const thresholds = thresholdsFromSettings(variance)

  const client = clientGenerate({ baseExtraction: base, files: FILES, thresholds })
  const server = await buildGenerateResponse({
    files: FILES,
    extractions: { base, supporting: [] },
    style: {},
    variance
  })

  assert.equal(server.status, 200)
  assert.equal(client.success, true)
  assert.deepEqual(client.variance, server.body.variance)
  assert.deepEqual(client.narrative, server.body.narrative)
  assert.deepEqual(client.extraction, server.body.extraction)
})

test('client fallback honors non-default thresholds (parity with server)', async () => {
  const base = baseExtraction()
  const variance = { dollarThreshold: '100000', percentThreshold: '10000' } // nothing triggers
  const thresholds = thresholdsFromSettings(variance)

  const client = clientGenerate({ baseExtraction: base, files: FILES, thresholds })
  const server = await buildGenerateResponse({ files: FILES, extractions: { base, supporting: [] }, style: {}, variance })

  assert.deepEqual(client.narrative, server.body.narrative)
  // No row should be narrated at this threshold (parity sanity check).
  const triggered = client.narrative.periods.flatMap((p) => p.highVariances)
  assert.equal(triggered.length, 0)
})

test('client fallback carries the standard response shape', () => {
  const client = clientGenerate({
    baseExtraction: baseExtraction(),
    files: FILES,
    thresholds: { amount: 1000, percent: 10 }
  })
  assert.equal(client.success, true)
  assert.match(client.jobId, /^LOCAL-/)
  assert.equal(client.filesReceived, 1)
  assert.equal(client.settingsReceived, true)
  assert.ok(client.narrative && Array.isArray(client.narrative.periods))
})
