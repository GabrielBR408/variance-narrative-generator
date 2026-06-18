// NQ-6C.2 tests — Sectioned GL Parser + File Type Detection
//
// Two supporting-file shapes the flat normalizer could not read are now detected
// at parse time and routed correctly:
//   • Sectioned GL  — account sections (header row with the account name + a
//     "Balance Forward" marker) followed by transaction rows. The account name
//     lives on the section header, not on each row, so the flat parser indexed
//     nothing. It is now flattened to one-transaction-per-row carrying the
//     account name, which the evidence index consumes — so HVAC Contract,
//     Janitorial Contract and Security Contract get GL citations again.
//   • Budget summary — a by-account Current/YTD Actual/Budget/Variance summary.
//     It has no transaction detail, so it is tagged and never mined for GL rows.
//
// Detection is content-based and automatic (no user labelling), and existing
// flat-GL parsing is left unchanged.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  detectSectionedGL,
  parseSectionedGL,
  detectBudgetSummary,
  SECTIONED_GL,
  BUDGET_SUMMARY,
  SECTIONED_GL_COLUMNS
} from '../src/lib/extract/fileType.js'
import { normalize } from '../src/lib/extract/normalize.js'
import { buildEvidenceIndex, matchAccount, scoreMatch } from '../src/lib/enrich/match.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { _buildPackets } from '../server/llm.js'

// --- fixtures --------------------------------------------------------------

// A raw sectioned-GL grid exactly as the spreadsheet parser hands it over:
// two metadata/header rows, then three account sections (each opening with a
// "Balance Forward" row carrying the account name in col 3), transaction rows,
// and a per-section total row that must NOT be mined as a transaction.
function sectionedGrid() {
  const wide = (cells) => {
    const row = new Array(13).fill('')
    for (const [i, v] of Object.entries(cells)) row[i] = v
    return row
  }
  // header(name) → section header; txn(...) → transaction; total → section total.
  const header = (name) => wide({ 0: '74698', 1: '01/26', 3: name, 9: 'Balance Forward', 12: '0' })
  const txn = (date, ref, memo, debit, balance) =>
    wide({ 0: '74698', 1: '01/26', 3: date, 4: 'AP', 5: ref, 9: memo, 10: debit, 12: balance })
  const total = (name, debit) => wide({ 9: `Total ${name}`, 10: debit })
  return [
    wide({ 0: 'YTD General Ledger — Property 74698' }),
    wide({ 0: 'Entity', 1: 'Period', 3: 'Date', 4: 'Source', 5: 'Reference', 9: 'Description', 10: 'Debit', 11: 'Credit', 12: 'Balance' }),
    header('HVAC Contract'),
    txn('01/15/2026', 'CHK1001', 'Monthly HVAC service ABC Mechanical', '3000', '3000'),
    txn('02/15/2026', 'CHK1042', 'Monthly HVAC service ABC Mechanical', '3000', '6000'),
    total('HVAC Contract', '6000'),
    header('Janitorial Contract'),
    txn('01/31/2026', 'CHK1100', 'Janitorial CleanCo Services', '4500', '4500'),
    total('Janitorial Contract', '4500'),
    header('Security Contract'),
    txn('01/20/2026', 'CHK1200', 'Security SecureGuard LLC', '4000', '4000'),
    total('Security Contract', '4000')
  ]
}

const BUDGET_COLUMNS = [
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

function normalizedFromGrid(grid, kind = 'spreadsheet') {
  return normalize({ tables: [{ rows: grid }] }, kind).normalized
}

function supporting({ fileName, type = 'Supporting Document', normalized }) {
  return { fileName, status: 'ok', classification: { type }, normalized }
}

// shared base-narrative helpers (same shape as test/nq6c1.test.js)
function rec({ account, actual, budget = null, accountType = 'expense', category = 'unfavorable' }) {
  const varianceAmount = actual - budget
  const variancePercent = budget === 0 ? null : (varianceAmount / Math.abs(budget)) * 100
  return {
    account,
    actual,
    budget,
    prior: null,
    varianceAmount,
    variancePercent,
    comparisonType: 'budget',
    thresholdTriggered: Math.abs(varianceAmount) >= 1000 || (variancePercent !== null && Math.abs(variancePercent) >= 10),
    category,
    accountType,
    missingData: false,
    confidence: 90,
    sourceRows: []
  }
}

function baseNarrative(comparisons) {
  return generateNarrative({
    fileId: 'base',
    fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{ period: 'current', comparisons }]
  })
}

function allNotes(narrative) {
  const p = narrative.periods[0]
  return [...p.highVariances, ...p.revenueNotes, ...p.expenseNotes]
}

const CONTRACTS = ['HVAC Contract', 'Janitorial Contract', 'Security Contract']

// --- sectioned GL: detection + flattening ----------------------------------

test('detectSectionedGL is true for an account-sectioned grid', () => {
  assert.equal(detectSectionedGL(sectionedGrid()), true)
})

test('detectSectionedGL is false for a flat table and a budget summary', () => {
  const flat = [
    ['Account', 'Amount'],
    ['HVAC Contract', '6000']
  ]
  assert.equal(detectSectionedGL(flat), false)
  assert.equal(detectSectionedGL([BUDGET_COLUMNS, ['HVAC Contract', '1', '2', '3', '4', '5', '6', '7', '8']]), false)
})

test('parseSectionedGL flattens to one transaction per row, carrying the account name', () => {
  const { columns, rows } = parseSectionedGL(sectionedGrid())
  assert.deepEqual(columns, SECTIONED_GL_COLUMNS)
  // Four transactions total; the three "Total …" rows and "Balance Forward"
  // section headers are excluded.
  assert.equal(rows.length, 4)
  assert.deepEqual(rows.map((r) => r[0]), [
    'HVAC Contract',
    'HVAC Contract',
    'Janitorial Contract',
    'Security Contract'
  ])
  // First HVAC row: [account, date, reference, memo, debit, credit, balance].
  assert.deepEqual(rows[0], [
    'HVAC Contract',
    '01/15/2026',
    'CHK1001',
    'Monthly HVAC service ABC Mechanical',
    '3000',
    '',
    '3000'
  ])
  // No "Total …" or "Balance Forward" leaked into the memo column.
  for (const r of rows) {
    assert.doesNotMatch(r[3], /balance forward|^total /i)
  }
})

test('parseSectionedGL drops transactions that appear before any section header', () => {
  const grid = sectionedGrid()
  // A stray dated row inserted above the first section header has no account.
  grid.splice(2, 0, ['74698', '01/26', '', '01/01/2026', 'AP', 'CHK0001', '', '', '', 'Orphan row', '99', '', '99'])
  const { rows } = parseSectionedGL(grid)
  assert.ok(!rows.some((r) => r[2] === 'CHK0001'), 'orphan pre-section row is not indexed')
})

// --- sectioned GL: through the normalizer ----------------------------------

test('normalize() tags a sectioned GL and flattens it (spreadsheet kind)', () => {
  const normalized = normalizedFromGrid(sectionedGrid())
  assert.equal(normalized.fileType, SECTIONED_GL)
  assert.deepEqual(normalized.columns, SECTIONED_GL_COLUMNS)
  assert.equal(normalized.rows.length, 4)
})

test('normalize() does NOT flatten the same grid for a non-spreadsheet kind', () => {
  // Detection is spreadsheet-gated; a PDF reconstruction must not be flattened.
  const normalized = normalize({ tables: [{ rows: sectionedGrid() }] }, 'pdf').normalized
  assert.notEqual(normalized.fileType, SECTIONED_GL)
})

// --- sectioned GL: evidence index + matching -------------------------------

test('buildEvidenceIndex maps each sectioned-GL account to its transaction rows', () => {
  const idx = buildEvidenceIndex([supporting({ fileName: 'YTD Gl.XLSX', normalized: normalizedFromGrid(sectionedGrid()) })])
  assert.equal(idx.length, 4)
  // Content detection classifies it as GL even though the file name didn't.
  assert.ok(idx.every((e) => e.classificationType === 'General Ledger (GL)'))
  assert.deepEqual(
    idx.map((e) => e.normName),
    ['hvac contract', 'hvac contract', 'janitorial contract', 'security contract']
  )
  assert.equal(scoreMatch('HVAC Contract', idx[0]), 0.9)
})

test('matchAccount returns thick, debit-typed citations for each contract account', () => {
  const idx = buildEvidenceIndex([supporting({ fileName: 'YTD Gl.XLSX', normalized: normalizedFromGrid(sectionedGrid()) })])
  for (const account of CONTRACTS) {
    const cites = matchAccount(account, idx)
    assert.equal(cites.length, 1, `${account} has one citation`)
    const c = cites[0]
    assert.equal(c.confidence, 0.9, `${account} matches by name`)
    assert.equal(c.thick, true, `${account} citation is thick`)
    assert.ok(
      c.matchedRows.every((r) => typeof r.debit === 'number'),
      `${account} rows carry a typed debit`
    )
    assert.ok(c.matchedRows.some((r) => r.descText), `${account} rows carry a memo`)
  }
})

// --- budget summary: detection + skip --------------------------------------

test('detectBudgetSummary is true for the budget pattern, false otherwise', () => {
  assert.equal(detectBudgetSummary(BUDGET_COLUMNS), true)
  assert.equal(detectBudgetSummary(SECTIONED_GL_COLUMNS), false)
  assert.equal(detectBudgetSummary(['Account', 'Amount', 'Memo']), false)
})

test('normalize() tags a budget summary (works for a PDF-reconstructed worksheet)', () => {
  const grid = [BUDGET_COLUMNS, ['HVAC Contract', '18000', '12000', '6000', '50', '18000', '12000', '6000', '50']]
  // FILE 1 (Detail GL Worksheet.pdf) arrives as a reconstructed PDF table.
  const normalized = normalize({ tables: [{ rows: grid }] }, 'pdf').normalized
  assert.equal(normalized.fileType, BUDGET_SUMMARY)
  // Columns/rows are untouched — only the tag is added.
  assert.deepEqual(normalized.columns, BUDGET_COLUMNS)
})

test('buildEvidenceIndex skips a budget summary entirely (no GL evidence rows)', () => {
  const normalized = {
    columns: BUDGET_COLUMNS,
    rows: [['HVAC Contract', '18000', '12000', '6000', '50', '18000', '12000', '6000', '50']],
    fileType: BUDGET_SUMMARY
  }
  // Even though the file name says "GL", the budget-summary tag wins.
  const idx = buildEvidenceIndex([supporting({ fileName: 'Detail GL Worksheet.pdf', type: 'General Ledger (GL)', normalized })])
  assert.equal(idx.length, 0)
})

// --- regression: a flat table is unchanged (no tag, still indexes) ----------

test('a plain flat GL is not tagged and still indexes as before', () => {
  const normalized = normalizedFromGrid([
    ['Account', 'Amount'],
    ['Utility Expense Recovery', '7366']
  ])
  assert.equal(normalized.fileType, undefined)
  const idx = buildEvidenceIndex([supporting({ fileName: 'gl.xlsx', normalized })])
  assert.equal(idx.length, 1)
  assert.equal(idx[0].normName, 'utility expense recovery')
})

// --- end-to-end: the sectioned GL enriches the three contract notes ---------

const FLAGGED = [
  rec({ account: 'HVAC Contract', actual: 18000, budget: 12000 }),
  rec({ account: 'Janitorial Contract', actual: 9000, budget: 4500 }),
  rec({ account: 'Security Contract', actual: 7000, budget: 3000 })
]

test('enrichNarrative: each contract account gets support + prepared GL rows from the sectioned GL', () => {
  const gl = supporting({ fileName: 'YTD Gl.XLSX', normalized: normalizedFromGrid(sectionedGrid()) })
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [gl] })
  for (const account of CONTRACTS) {
    const note = allNotes(enriched).find((n) => n.account === account)
    assert.ok(note, `${account} note exists`)
    assert.equal(note.enriched, true, `${account} is enriched`)
    assert.ok(Array.isArray(note.support) && note.support.length >= 1, `${account} has support`)
    assert.ok(note.preparedEvidence && note.preparedEvidence.glRows.length >= 1, `${account} has prepared GL rows`)
  }
})

test('_buildPackets emits glRows with an amount and a memo for each contract account', () => {
  const gl = supporting({ fileName: 'YTD Gl.XLSX', normalized: normalizedFromGrid(sectionedGrid()) })
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [gl] })
  const packets = _buildPackets(allNotes(enriched), 'current')
  for (const account of CONTRACTS) {
    const packet = packets.find((p) => p.account === account)
    assert.ok(packet, `${account} produced an evidence packet`)
    assert.ok(packet.glRows.length >= 1, `${account} packet carries GL rows`)
    assert.ok(packet.glRows.some((r) => r.amount !== null), `${account} packet has an amount`)
    assert.ok(packet.glRows.some((r) => r.memo), `${account} packet has a memo to cite`)
  }
})

test('a budget summary alongside the GL adds no GL rows of its own', () => {
  const gl = supporting({ fileName: 'YTD Gl.XLSX', normalized: normalizedFromGrid(sectionedGrid()) })
  const budget = supporting({
    fileName: 'Detail GL Worksheet.pdf',
    type: 'General Ledger (GL)',
    normalized: {
      columns: BUDGET_COLUMNS,
      rows: [['HVAC Contract', '18000', '12000', '6000', '50', '18000', '12000', '6000', '50']],
      fileType: BUDGET_SUMMARY
    }
  })
  // Index built from BOTH files equals the index from the GL alone.
  const both = buildEvidenceIndex([budget, gl])
  const glOnly = buildEvidenceIndex([gl])
  assert.equal(both.length, glOnly.length)
})
