// Generate-flow tests — Phase 9B.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
// Exercises the deterministic generate pipeline end to end:
//   normalized extraction → variance → narrative → structured response
// plus the request-level validation and the real HTTP endpoint wiring.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { runPipeline } from '../src/lib/pipeline.js'
import { buildGenerateResponse, handleGenerate } from '../server/generate.js'
import { checkIpLimit, checkGlobalLimit, enrichWithLLM, _resetLimitsForTest } from '../server/llm.js'

// --- Fixtures -------------------------------------------------------------
// A real-shaped statement: Account + Current{Actual,Budget,Var,Var%} +
// YTD{Actual,Budget,Var,Var%}. The variance columns are present (as the PDF has
// them) but the engine recomputes from Actual − Budget, so they are never read.
const COLUMNS = [
  'Account',
  'Current Actual',
  'Current Budget',
  'Current Variance',
  'Current Variance %',
  'YTD Actual',
  'YTD Budget',
  'YTD Variance',
  'YTD Variance %'
]
const ROWS = [
  [
    'Rental Inc. - Commercial',
    '29517.42', '37392.22', '-7874.80', '-21.06%',
    '358495.18', '374173.03', '-15677.85', '-4.19%'
  ],
  [
    'Utility-Elect-Building',
    '614.87', '530.06', '84.81', '16.00%',
    '5896.96', '5420.00', '476.96', '8.80%'
  ]
]

function extraction(overrides = {}) {
  return {
    fileId: 'f1',
    fileName: 'statement.pdf',
    status: 'ok',
    confidence: 75,
    classification: { type: 'variance-report' },
    normalized: { columns: COLUMNS, rows: ROWS, accounts: [], dates: [], values: [] },
    ...overrides
  }
}

const baseFile = { name: 'statement.pdf', size: 1234, type: 'application/pdf', role: 'baseReport' }
const near = (a, b, eps = 0.05) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b} (±${eps})`)

// --- runPipeline ----------------------------------------------------------

test('runPipeline produces extraction + variance + narrative for a valid upload', () => {
  const out = runPipeline(extraction())

  // The required response shape.
  assert.deepEqual(Object.keys(out).sort(), ['extraction', 'narrative', 'variance'])

  // Extraction is echoed faithfully (rows passed through, not invented).
  assert.equal(out.extraction.status, 'ok')
  assert.equal(out.extraction.rowCount, 2)
  assert.deepEqual(out.extraction.columns, COLUMNS)

  // Variance computed both periods; narrative has one section bundle per period.
  assert.deepEqual(out.variance.comparisonSets.map((s) => s.period), ['current', 'ytd'])
  assert.deepEqual(out.narrative.periods.map((p) => p.period), ['current', 'ytd'])
  assert.ok(out.narrative.periods[0].executiveSummary.length > 0)
})

test('runPipeline degrades cleanly for a non-tabular extraction (no invented output)', () => {
  const out = runPipeline(
    extraction({ normalized: { columns: [], rows: [['just text']], accounts: [], dates: [], values: [] } })
  )
  // Variance is honest about why there is nothing to compute.
  assert.equal(out.variance.reason, 'not-tabular')
  assert.equal(out.variance.comparisons.length, 0)

  // The narrative still renders, but invents nothing: no flagged variances and
  // no source rows behind any sentence.
  for (const period of out.narrative.periods) {
    assert.equal(period.highVariances.length, 0)
    assert.equal(period.revenueNotes.length, 0)
    assert.equal(period.expenseNotes.length, 0)
    assert.equal(period.sourceRows.length, 0)
  }
})

// --- buildGenerateResponse (request-level) --------------------------------

test('successful upload yields a 200 with extraction, variance and narrative', async () => {
  const { status, body } = await buildGenerateResponse({
    files: [baseFile],
    extractions: { base: extraction(), supporting: [] },
    style: { audience: 'Owner' },
    variance: { dollarThreshold: '1000', percentThreshold: '10' }
  })

  assert.equal(status, 200)
  assert.equal(body.success, true)
  assert.equal(body.settingsReceived, true)
  assert.equal(body.filesReceived, 1)
  assert.ok(body.extraction && body.variance && body.narrative)
  assert.ok(body.narrative.periods.length > 0)
})

test('missing base report is rejected cleanly before any analysis', async () => {
  const { status, body } = await buildGenerateResponse({
    files: [{ ...baseFile, role: 'supportingFile' }],
    extractions: { base: extraction(), supporting: [] }
  })
  assert.equal(status, 422)
  assert.equal(body.success, false)
  assert.match(body.error, /base variance report/i)
  assert.equal(body.narrative, undefined)
})

test('missing extraction payload is rejected cleanly', async () => {
  const { status, body } = await buildGenerateResponse({ files: [baseFile], extractions: null })
  assert.equal(status, 422)
  assert.equal(body.success, false)
  assert.equal(body.narrative, undefined)
})

test('a base report that did not extract cleanly is rejected, not fabricated', async () => {
  const { status, body } = await buildGenerateResponse({
    files: [baseFile],
    extractions: { base: extraction({ status: 'error', normalized: { columns: [], rows: [] } }), supporting: [] }
  })
  assert.equal(status, 422)
  assert.equal(body.success, false)
  assert.equal(body.narrative, undefined)
})

// --- No invented values / source-row traceability -------------------------

test('every narrated figure traces to a source row and matches Actual − Budget', async () => {
  const { body } = await buildGenerateResponse({
    files: [baseFile],
    extractions: { base: extraction(), supporting: [] },
    variance: { dollarThreshold: '1000', percentThreshold: '10' }
  })

  const rows = body.extraction.rows
  const current = body.narrative.periods.find((p) => p.period === 'current')

  // There is something to check, and each high-variance note ties back to data.
  assert.ok(current.highVariances.length > 0)
  for (const note of current.highVariances) {
    // Source rows are real indices into the extraction we were handed.
    assert.ok(note.sourceRows.length > 0)
    for (const idx of note.sourceRows) {
      assert.ok(idx >= 0 && idx < rows.length, `source row ${idx} out of range`)
    }
    // The narrated dollar movement equals Actual − Budget of its source row(s).
    const idx = note.sourceRows[0]
    const actual = Number(rows[idx][1])
    const budget = Number(rows[idx][2])
    near(note.varianceAmount, actual - budget)
  }
})

// --- Current/YTD preserved through the flow -------------------------------

test('Current/YTD support survives the generate flow', async () => {
  const { body } = await buildGenerateResponse({
    files: [baseFile],
    extractions: { base: extraction(), supporting: [] }
  })
  assert.deepEqual(body.variance.comparisonSets.map((s) => s.period), ['current', 'ytd'])
  assert.deepEqual(body.narrative.periods.map((p) => p.period), ['current', 'ytd'])

  // The YTD figures are the YTD columns, not a copy of Current.
  const ytd = body.narrative.periods.find((p) => p.period === 'ytd')
  const rental = ytd.highVariances.find((n) => n.account.startsWith('Rental'))
  near(rental.varianceAmount, -15677.85)
})

// --- Real HTTP endpoint flow ---------------------------------------------

// Build a minimal multipart/form-data body with one file + JSON fields.
function multipart(boundary, { file, fields }) {
  const parts = []
  if (file) {
    parts.push(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n` +
        `${file.content}\r\n`
    )
  }
  for (const [name, value] of Object.entries(fields || {})) {
    parts.push(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
        `${value}\r\n`
    )
  }
  parts.push(`--${boundary}--\r\n`)
  return Buffer.from(parts.join(''))
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    bodyText: '',
    setHeader(k, v) { this.headers[k] = v },
    end(payload) { this.bodyText = payload || '' }
  }
}

function postGenerate(body, headers) {
  const req = Readable.from([body])
  req.headers = headers
  const res = mockRes()
  return new Promise((resolve) => {
    const origEnd = res.end.bind(res)
    res.end = (payload) => {
      origEnd(payload)
      resolve(res)
    }
    handleGenerate(req, res)
  })
}

test('POST /generate returns a real narrative for a valid multipart request', async () => {
  const boundary = '----phase9btest'
  const body = multipart(boundary, {
    file: { field: 'baseReport', filename: 'statement.csv', contentType: 'text/csv', content: 'Account,Actual,Budget\n' },
    fields: {
      style: JSON.stringify({ audience: 'Owner' }),
      variance: JSON.stringify({ dollarThreshold: '1000', percentThreshold: '10' }),
      extractions: JSON.stringify({ base: extraction(), supporting: [] })
    }
  })

  const res = await postGenerate(body, { 'content-type': `multipart/form-data; boundary=${boundary}` })
  assert.equal(res.statusCode, 200)
  const data = JSON.parse(res.bodyText)
  assert.equal(data.success, true)
  assert.ok(data.narrative.periods.length > 0)
  assert.deepEqual(data.variance.comparisonSets.map((s) => s.period), ['current', 'ytd'])
})

test('POST /generate rejects a request with no base report', async () => {
  const boundary = '----phase9bnobasetest'
  const body = multipart(boundary, {
    file: { field: 'supportingFiles', filename: 'extra.csv', contentType: 'text/csv', content: 'x\n' },
    fields: { extractions: JSON.stringify({ base: extraction(), supporting: [] }) }
  })

  const res = await postGenerate(body, { 'content-type': `multipart/form-data; boundary=${boundary}` })
  assert.equal(res.statusCode, 422)
  const data = JSON.parse(res.bodyText)
  assert.equal(data.success, false)
  assert.match(data.error, /base variance report/i)
})

// --- NQ-6A: IP rate limiter -------------------------------------------------

test('IP rate limiter allows first 5 requests and blocks the 6th', () => {
  _resetLimitsForTest()
  const ip = '10.0.0.1'
  for (let i = 0; i < 5; i++) {
    assert.equal(checkIpLimit(ip), true, `request ${i + 1} should be allowed`)
  }
  assert.equal(checkIpLimit(ip), false, '6th request should be blocked')
})

test('IP rate limiter is independent per IP', () => {
  _resetLimitsForTest()
  for (let i = 0; i < 5; i++) checkIpLimit('10.0.0.2')
  // Different IP should still be allowed
  assert.equal(checkIpLimit('10.0.0.3'), true)
})

// --- NQ-6A: Global circuit breaker ------------------------------------------

test('global circuit breaker trips at 201st call', () => {
  _resetLimitsForTest()
  for (let i = 0; i < 200; i++) {
    assert.equal(checkGlobalLimit(), true, `call ${i + 1} should be allowed`)
  }
  assert.equal(checkGlobalLimit(), false, '201st call should be blocked')
})

// --- NQ-6A: Fallback — both limits return valid deterministic narrative ------

test('rate-limited request returns valid deterministic narrative unchanged', async () => {
  _resetLimitsForTest()
  // exhaust IP limit
  for (let i = 0; i < 5; i++) checkIpLimit('192.168.1.1')

  // buildGenerateResponse with flag off (default) — narrative unaffected
  const { status, body } = await buildGenerateResponse({
    files: [baseFile],
    extractions: { base: extraction(), supporting: [] },
    ip: '192.168.1.1'
  })
  assert.equal(status, 200)
  assert.equal(body.success, true)
  assert.ok(body.narrative.periods.length > 0)
})

test('circuit-breaker-tripped request returns valid deterministic narrative unchanged', async () => {
  _resetLimitsForTest()
  for (let i = 0; i < 200; i++) checkGlobalLimit()

  const { status, body } = await buildGenerateResponse({
    files: [baseFile],
    extractions: { base: extraction(), supporting: [] }
  })
  assert.equal(status, 200)
  assert.equal(body.success, true)
  assert.ok(body.narrative.periods.length > 0)
})

// --- NQ-6A: enrichWithLLM stub ----------------------------------------------

test('enrichWithLLM stub returns input flaggedNotes unmodified', async () => {
  const notes = [{ account: 'Rent', varianceAmount: -7874.8, sourceRows: [0] }]
  const result = await enrichWithLLM(notes, {})
  assert.deepEqual(result, notes)
})

test('enrichWithLLM stub works with empty notes array', async () => {
  const result = await enrichWithLLM([], {})
  assert.deepEqual(result, [])
})
