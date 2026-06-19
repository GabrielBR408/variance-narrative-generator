// Enrichment status tests — Fix Phase A (trust fix, surface-only).
// Runs on Node's built-in test runner (`node --test`); no DOM, no extra deps.
//
// Covers:
//   • all eligible lines enriched + reason 'ok' -> "AI-enriched"
//   • a fallback for each reason -> "Basic narrative (AI unavailable)" + the
//     correct plain-language reason mapping (incl. unknown -> api_error catch-all)
//   • the AI-available-but-no-GL ('none') case
//   • the server propagates a fixed-enum enrichmentReason on the response
//   • the XLSX Owner Summary header carries the AI status line

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  enrichmentStatus,
  enrichmentStatusLine,
  normalizeReason,
  ENRICHMENT_REASONS
} from '../src/lib/enrichmentStatus.js'
import { buildExcelModel } from '../src/lib/export/excel.js'
import { buildGenerateResponse } from '../server/generate.js'

// --- Fixtures --------------------------------------------------------------

// A GL-supported, LLM-enriched note (the shape produced after enrichWithLLM).
function enrichedNote(account = 'Repairs & Maintenance') {
  return {
    account,
    varianceAmount: -8500,
    text: `${account} exceeded budget by $8,500. [ENRICHED] Detail cites ABC HVAC.`,
    llmEnriched: true,
    support: [{ fileName: 'GL.xlsx', classificationType: 'General Ledger (GL)', confidence: 0.9 }]
  }
}

// A GL-supported note that was NOT LLM-enriched (the fallback case).
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

// --- normalizeReason -------------------------------------------------------

test('normalizeReason passes through known reasons and defaults unknown to api_error', () => {
  for (const r of ENRICHMENT_REASONS) assert.equal(normalizeReason(r), r)
  assert.equal(normalizeReason(undefined), 'api_error')
  assert.equal(normalizeReason(null), 'api_error')
  assert.equal(normalizeReason('something-else'), 'api_error')
})

// --- all enriched -> AI-enriched -------------------------------------------

test('all eligible lines enriched + reason ok -> AI-enriched', () => {
  const narrative = narrativeWith([enrichedNote('Repairs'), enrichedNote('Utilities')])
  const s = enrichmentStatus({ narrative, reason: 'ok' })
  assert.equal(s.statusKind, 'enriched')
  assert.equal(s.status, 'AI-enriched')
  assert.match(s.message, /reflects your style settings/)
  assert.equal(s.enrichedCount, 2)
  assert.equal(s.eligibleCount, 2)
  assert.equal(s.fallbackCount, 0)
})

// --- fallback per reason ---------------------------------------------------

const REASON_CASES = [
  { reason: 'rate_limit', text: 'daily limit reached' },
  { reason: 'circuit_breaker', text: 'daily capacity reached' },
  { reason: 'api_error', text: 'AI temporarily unavailable' }
]

for (const { reason, text } of REASON_CASES) {
  test(`fallback reason ${reason} -> Basic narrative + "${text}"`, () => {
    const narrative = narrativeWith([fallbackNote('Repairs'), fallbackNote('Utilities')])
    const s = enrichmentStatus({ narrative, reason })
    assert.equal(s.statusKind, 'fallback')
    assert.equal(s.status, 'Basic narrative (AI unavailable)')
    assert.equal(s.reason, reason)
    assert.equal(s.reasonText, text)
    assert.match(s.message, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(s.message, /Style settings other than dollar formatting may not apply/)
    assert.equal(s.enrichedCount, 0)
    assert.equal(s.eligibleCount, 2)
    assert.equal(s.fallbackCount, 2)
  })
}

test('an unknown/missing reason falls back via the api_error catch-all', () => {
  const narrative = narrativeWith([fallbackNote()])
  const s = enrichmentStatus({ narrative, reason: undefined })
  assert.equal(s.statusKind, 'fallback')
  assert.equal(s.reason, 'api_error')
  assert.equal(s.reasonText, 'AI temporarily unavailable')
})

test('partial enrichment with reason ok still reports a fallback (catch-all api_error)', () => {
  const narrative = narrativeWith([enrichedNote('Repairs'), fallbackNote('Utilities')])
  const s = enrichmentStatus({ narrative, reason: 'ok' })
  assert.equal(s.statusKind, 'fallback')
  assert.equal(s.reason, 'api_error')
  assert.equal(s.enrichedCount, 1)
  assert.equal(s.eligibleCount, 2)
  assert.equal(s.fallbackCount, 1)
})

// --- AI available but nothing to enrich ------------------------------------

test('reason ok with no GL-eligible lines -> none (basic narrative, no overclaim)', () => {
  const narrative = narrativeWith([{ account: 'Misc', text: 'Misc moved $2,000.' }])
  const s = enrichmentStatus({ narrative, reason: 'ok' })
  assert.equal(s.statusKind, 'none')
  assert.equal(s.eligibleCount, 0)
  assert.equal(s.enrichedCount, 0)
  assert.doesNotMatch(s.message, /reflects your style settings/)
})

// --- export header line ----------------------------------------------------

test('enrichmentStatusLine combines status and reason for the export header', () => {
  assert.equal(
    enrichmentStatusLine({ status: 'AI-enriched', reasonText: '' }),
    'AI-enriched'
  )
  assert.equal(
    enrichmentStatusLine({ status: 'Basic narrative (AI unavailable)', reasonText: 'daily limit reached' }),
    'Basic narrative (AI unavailable) — daily limit reached'
  )
  assert.equal(enrichmentStatusLine(null), '')
})

test('XLSX Owner Summary meta includes the AI Status line when enrichment is supplied', () => {
  const narrative = { fileName: 'statement.pdf', ...narrativeWith([enrichedNote()]) }
  const enrichment = enrichmentStatus({ narrative, reason: 'ok' })
  const model = buildExcelModel(narrative, { generatedDate: new Date('2026-06-19T00:00:00Z'), enrichment })
  const byLabel = Object.fromEntries(model.meta.map((m) => [m.label, m.value]))
  assert.equal(byLabel['AI Status'], 'AI-enriched')
})

test('XLSX meta omits the AI Status line when no enrichment is supplied (unchanged exports)', () => {
  const narrative = { fileName: 'statement.pdf', ...narrativeWith([enrichedNote()]) }
  const model = buildExcelModel(narrative, { generatedDate: new Date('2026-06-19T00:00:00Z') })
  const labels = model.meta.map((m) => m.label)
  assert.ok(!labels.includes('AI Status'))
})

// --- server propagation ----------------------------------------------------

const COLUMNS = ['Account', 'Current Actual', 'Current Budget', 'YTD Actual', 'YTD Budget']
const ROWS = [['Repairs', '45000', '30000', '120000', '100000']]
const baseFile = { name: 'statement.pdf', size: 1234, type: 'application/pdf', role: 'baseReport' }
function extraction() {
  return {
    fileId: 'f1', fileName: 'statement.pdf', status: 'ok', confidence: 75,
    classification: { type: 'variance-report' },
    normalized: { columns: COLUMNS, rows: ROWS, accounts: [], dates: [], values: [] }
  }
}

test('buildGenerateResponse reports a fixed-enum enrichmentReason (LLM off in test env -> api_error)', async () => {
  const { status, body } = await buildGenerateResponse({
    files: [baseFile],
    extractions: { base: extraction(), supporting: [] },
    llmMode: 'cited'
  })
  assert.equal(status, 200)
  assert.ok(ENRICHMENT_REASONS.includes(body.enrichmentReason))
  // LLM_ENABLED is false in the test environment, so AI is not available.
  assert.equal(body.enrichmentReason, 'api_error')
})
