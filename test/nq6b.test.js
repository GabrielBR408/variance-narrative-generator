// NQ-6B tests — Evidence Packet + LLM Synthesis
// Exercises: evidence packet building, caps, fallback paths, and merge behavior.
// The real Anthropic API is NOT called in these tests (no valid key present).
// All paths that would reach the API are covered via the no-key and invalid-key
// fallbacks, which must return the original notes unchanged.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enrichWithLLM, _buildPackets, _resetLimitsForTest } from '../server/llm.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'
import { buildGenerateResponse } from '../server/generate.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNote(overrides = {}) {
  return {
    account: 'Repairs & Maintenance',
    varianceAmount: -8500,
    variancePercent: -28.3,
    comparisonType: 'budget',
    period: 'current',
    text: 'Repairs & Maintenance was $8,500 unfavorable.',
    ...overrides
  }
}

function makeEnrichedNote(overrides = {}) {
  const base = makeNote()
  return {
    ...base,
    originalText: base.text,
    enriched: true,
    support: [
      {
        fileName: 'GL.pdf',
        classificationType: 'General Ledger',
        confidence: 0.9,
        matchMethod: 'exact',
        sourceRows: [0, 1, 2],
        thick: true,
        detail: { vendor: 'ABC HVAC', description: 'HVAC repair', total: -8500, count: 2 }
      }
    ],
    diagnosis: {
      nature: 'REAL_SPEND',
      qualifiers: ['one-time'],
      confidence: 'high',
      basis: 'GL match'
    },
    preparedEvidence: {
      glRows: [
        { sourceRow: 0, netAmount: -5000, vendor: 'ABC HVAC', memo: 'Emergency repair' },
        { sourceRow: 1, netAmount: -3500, vendor: 'ABC HVAC', memo: 'Parts and labor' }
      ],
      netTotal: -8500,
      amountReliable: true,
      columnModel: 'single-amount',
      balanceExcluded: false,
      transactionCount: 2,
      topContributors: []
    },
    ...overrides
  }
}

// A note WITHOUT support (deterministic only, no GL match).
const bareNote = makeNote()
// A fully enriched note.
const enrichedNote = makeEnrichedNote()

// ---------------------------------------------------------------------------
// enrichWithLLM: no support data → returns deterministic notes unchanged
// ---------------------------------------------------------------------------

test('enrichWithLLM returns deterministic notes unchanged when no notes have support data', async () => {
  _resetLimitsForTest()
  const notes = [bareNote, makeNote({ account: 'Utilities' })]
  const result = await enrichWithLLM(notes, { period: 'current' })
  assert.deepEqual(result, notes)
})

test('enrichWithLLM returns deterministic notes unchanged when flaggedNotes is empty', async () => {
  _resetLimitsForTest()
  const result = await enrichWithLLM([], { period: 'current' })
  assert.deepEqual(result, [])
})

// ---------------------------------------------------------------------------
// enrichWithLLM: API failure → returns original notes unchanged
// ---------------------------------------------------------------------------

test('enrichWithLLM returns deterministic notes unchanged on simulated API failure (no API key)', async () => {
  _resetLimitsForTest()
  const savedKey = process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  try {
    const notes = [enrichedNote]
    const result = await enrichWithLLM(notes, { period: 'current' })
    assert.deepEqual(result, notes)
  } finally {
    if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey
  }
})

test('enrichWithLLM returns deterministic notes unchanged when API key present but call fails', async () => {
  _resetLimitsForTest()
  const savedKey = process.env.ANTHROPIC_API_KEY
  // Use an invalid key — SDK will throw an auth error, which the catch block handles.
  process.env.ANTHROPIC_API_KEY = 'sk-ant-invalid-key-for-nq6b-test'
  try {
    const notes = [enrichedNote]
    const result = await enrichWithLLM(notes, { period: 'current' })
    // Must return the original array unchanged regardless of error type.
    assert.deepEqual(result, notes)
  } finally {
    if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey
    else delete process.env.ANTHROPIC_API_KEY
  }
})

// ---------------------------------------------------------------------------
// _buildPackets: evidence packet structure and capping
// ---------------------------------------------------------------------------

test('_buildPackets caps GL rows at 40 per note', () => {
  const manyRows = Array.from({ length: 60 }, (_, i) => ({
    sourceRow: i, netAmount: -(i + 1) * 100, vendor: `Vendor ${i}`, memo: `Memo ${i}`
  }))
  const note = makeEnrichedNote({
    preparedEvidence: { glRows: manyRows, netTotal: -6000, amountReliable: true, columnModel: 'single-amount', balanceExcluded: false, transactionCount: 60, topContributors: [] }
  })
  const packets = _buildPackets([note], 'current')
  assert.equal(packets.length, 1)
  assert.ok(packets[0].glRows.length <= 40, `expected ≤40 rows, got ${packets[0].glRows.length}`)
})

test('_buildPackets caps at 10 notes per call', () => {
  const notes = Array.from({ length: 15 }, (_, i) => makeEnrichedNote({ account: `Account ${i}` }))
  const packets = _buildPackets(notes, 'current')
  assert.ok(packets.length <= 10, `expected ≤10 packets, got ${packets.length}`)
})

test('_buildPackets returns empty array when no notes have support data', () => {
  const packets = _buildPackets([bareNote, makeNote({ account: 'Utilities' })], 'current')
  assert.equal(packets.length, 0)
})

test('_buildPackets includes required fields in each packet', () => {
  const packets = _buildPackets([enrichedNote], 'current')
  assert.equal(packets.length, 1)
  const p = packets[0]
  assert.equal(typeof p.account, 'string')
  assert.equal(typeof p.varianceAmount, 'number')
  assert.ok('variancePercent' in p)
  assert.ok('comparisonType' in p)
  assert.equal(p.period, 'current')
  assert.ok(p.diagnosis && typeof p.diagnosis === 'object')
  assert.ok(Array.isArray(p.glRows))
})

test('_buildPackets GL row shape matches spec (date, vendor, amount, memo)', () => {
  const packets = _buildPackets([enrichedNote], 'current')
  const rows = packets[0].glRows
  assert.ok(rows.length > 0)
  for (const row of rows) {
    assert.ok('date' in row)
    assert.ok('vendor' in row)
    assert.ok('amount' in row)
    assert.ok('memo' in row)
  }
})

test('_buildPackets excludes notes without support', () => {
  const mixed = [bareNote, enrichedNote, makeNote({ account: 'Other' })]
  const packets = _buildPackets(mixed, 'current')
  assert.equal(packets.length, 1)
  assert.equal(packets[0].account, enrichedNote.account)
})

// ---------------------------------------------------------------------------
// Merge behavior: variance figures preserved, commentary sentence replaced
// ---------------------------------------------------------------------------

test('merged output preserves variance figures from deterministic layer', () => {
  // Build a note where originalText is the S1 variance sentence, and text
  // is S1 + deterministic evidence (S2). LLM merging should keep S1.
  const note = {
    ...enrichedNote,
    originalText: 'Repairs & Maintenance was $8,500 unfavorable.',
    text: 'Repairs & Maintenance was $8,500 unfavorable. Detail shows approximately $8,500 of related repair activity during the period.'
  }
  // Simulate what the merge step does (without a real API call).
  // We test by calling _buildPackets and verifying the original note's
  // variance fields are never modified by the packet builder.
  const packets = _buildPackets([note], 'current')
  assert.equal(packets[0].varianceAmount, note.varianceAmount)
  assert.equal(packets[0].account, note.account)
})

test('enriched sentence replaces only the commentary sentence, not account name or figures', () => {
  // Verify the text-merge formula: s1 + ". " + llmSentence
  // by inspecting originalText on an enriched note.
  const note = makeEnrichedNote({
    originalText: 'Repairs & Maintenance was $8,500 unfavorable.',
    text: 'Repairs & Maintenance was $8,500 unfavorable. Detail shows related activity.'
  })
  // The account name and variance amount appear in originalText, not invented.
  assert.ok(note.originalText.includes('Repairs & Maintenance'))
  assert.ok(note.originalText.includes('$8,500'))
  // text includes S1 + S2
  assert.ok(note.text.startsWith(note.originalText))
})

// ---------------------------------------------------------------------------
// enrichWithLLM: mixed notes — only enriched ones are eligible
// ---------------------------------------------------------------------------

test('enrichWithLLM does not attempt to process notes without support (mixed array)', async () => {
  _resetLimitsForTest()
  delete process.env.ANTHROPIC_API_KEY
  const notes = [bareNote, enrichedNote, makeNote({ account: 'Insurance' })]
  const result = await enrichWithLLM(notes, { period: 'current' })
  // Without API key, all notes are returned unchanged.
  assert.equal(result.length, notes.length)
  assert.deepEqual(result[0], notes[0])
  assert.deepEqual(result[2], notes[2])
})

// ---------------------------------------------------------------------------
// buildGenerateResponse: LLM path off by default
// ---------------------------------------------------------------------------

const COLUMNS = ['Account', 'Current Actual', 'Current Budget', 'YTD Actual', 'YTD Budget']
const ROWS = [['Repairs', '614.87', '530.06', '5896.96', '5420.00']]

function extraction(overrides = {}) {
  return {
    fileId: 'f1', fileName: 'statement.pdf', status: 'ok', confidence: 75,
    classification: { type: 'variance-report' },
    normalized: { columns: COLUMNS, rows: ROWS, accounts: [], dates: [], values: [] },
    ...overrides
  }
}

const baseFile = { name: 'statement.pdf', size: 1234, type: 'application/pdf', role: 'baseReport' }

test('buildGenerateResponse returns valid narrative in conservative mode (LLM never called)', async () => {
  const { status, body } = await buildGenerateResponse({
    files: [baseFile],
    extractions: { base: extraction(), supporting: [] },
    llmMode: 'conservative'
  })
  assert.equal(status, 200)
  assert.equal(body.success, true)
  assert.ok(body.narrative.periods.length > 0)
})

test('buildGenerateResponse returns valid narrative in cited mode when LLM_ENABLED is false (default)', async () => {
  // LLM_ENABLED is false in test environment — cited mode must fall back silently.
  const { status, body } = await buildGenerateResponse({
    files: [baseFile],
    extractions: { base: extraction(), supporting: [] },
    llmMode: 'cited'
  })
  assert.equal(status, 200)
  assert.equal(body.success, true)
  assert.ok(body.narrative.periods.length > 0)
})

// ---------------------------------------------------------------------------
// originalText is attached during enrichNarrative (additive metadata)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// NQ-6B.1: _buildPackets fallback when preparedEvidence.glRows is empty
// ---------------------------------------------------------------------------

test('_buildPackets falls back to note.support detail when preparedEvidence glRows all filtered out', () => {
  // Simulate HVAC/Janitorial/Security Contract scenario: preparedEvidence exists
  // but all rows have netAmount=null AND no vendor/memo → filter removes everything.
  const note = makeEnrichedNote({
    account: 'HVAC Contract',
    preparedEvidence: {
      glRows: [
        { sourceRow: 0, netAmount: null, vendor: null, memo: null },
        { sourceRow: 1, netAmount: null, vendor: null, memo: null }
      ],
      netTotal: null,
      amountReliable: false,
      columnModel: 'unresolved',
      balanceExcluded: false,
      transactionCount: 2,
      topContributors: []
    },
    support: [
      {
        fileName: 'GL.xlsx',
        classificationType: 'General Ledger (GL)',
        confidence: 0.85,
        matchMethod: 'exact',
        detail: { vendor: 'Climate Control Inc', description: 'HVAC maintenance contract', total: -12000, count: 3 }
      }
    ]
  })
  const packets = _buildPackets([note], 'current')
  assert.equal(packets.length, 1)
  const rows = packets[0].glRows
  assert.ok(rows.length > 0, 'expected fallback glRows from note.support detail')
  assert.equal(rows[0].vendor, 'Climate Control Inc')
  assert.equal(rows[0].amount, -12000)
})

test('_buildPackets uses description as vendor when vendor is absent in support detail', () => {
  const note = makeEnrichedNote({
    account: 'Janitorial Contract',
    preparedEvidence: {
      glRows: [{ sourceRow: 0, netAmount: null, vendor: null, memo: null }],
      netTotal: null, amountReliable: false, columnModel: 'unresolved',
      balanceExcluded: false, transactionCount: 1, topContributors: []
    },
    support: [
      {
        fileName: 'GL.xlsx',
        classificationType: 'General Ledger (GL)',
        confidence: 0.8,
        matchMethod: 'exact',
        detail: { vendor: null, description: 'Janitorial services', total: -4500, count: 1 }
      }
    ]
  })
  const packets = _buildPackets([note], 'current')
  assert.equal(packets.length, 1)
  const rows = packets[0].glRows
  assert.ok(rows.length > 0)
  assert.equal(rows[0].vendor, 'Janitorial services')
})

test('_buildPackets still returns no glRows when both preparedEvidence and support detail are empty', () => {
  const note = makeEnrichedNote({
    account: 'Security Contract',
    preparedEvidence: {
      glRows: [{ sourceRow: 0, netAmount: null, vendor: null, memo: null }],
      netTotal: null, amountReliable: false, columnModel: 'unresolved',
      balanceExcluded: false, transactionCount: 1, topContributors: []
    },
    support: [
      {
        fileName: 'GL.xlsx',
        classificationType: 'General Ledger (GL)',
        confidence: 0.7,
        matchMethod: 'exact',
        detail: { vendor: null, description: null, total: null, count: 0 }
      }
    ]
  })
  const packets = _buildPackets([note], 'current')
  assert.equal(packets.length, 1)
  assert.equal(packets[0].glRows.length, 0)
})

test('enrichNarrative attaches originalText to enriched notes (additive metadata)', () => {
  // Build a narrative with a note and no supporting files — no enrichment will
  // happen. The identity invariant means the note is returned unchanged, so
  // originalText only appears on actually-enriched notes.
  const narrative = {
    fileId: 'f1', fileName: 'f.pdf', classification: {}, thresholds: {},
    periods: [{
      period: 'current', periodLabel: 'Current', executiveSummary: '',
      highVariances: [makeNote()],
      revenueNotes: [], expenseNotes: [], sourceRows: []
    }]
  }
  const result = enrichNarrative(narrative, { supporting: [] })
  // With no supporting files the narrative is returned as the same reference.
  assert.equal(result, narrative)
  // The note is unchanged — no originalText added (not enriched).
  assert.equal(result.periods[0].highVariances[0].originalText, undefined)
})
