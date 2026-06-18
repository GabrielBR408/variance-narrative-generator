// NQ-6C.1 tests — GL Evidence Index Fix
// Two failure modes are covered, both of which left buildEvidenceIndex with an
// empty entries array (so matchAccount returned [] and the LLM never saw GL rows
// for accounts like "HVAC Contract" / "Janitorial Contract" / "Security Contract"):
//   A) the account column holds only a numeric code (e.g. "6250"); the readable
//      account name lives in a description/memo column.
//   B) the account column header is not literally "Account" (e.g. "Code",
//      "Ledger") and is not in column 0, so it was never selected.
// Plus a multi-match selection case ("Account No" codes vs "Account Name" names)
// and a regression guard (a bare code with nothing to borrow is still skipped).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildEvidenceIndex,
  matchAccount,
  scoreMatch
} from '../src/lib/enrich/match.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { _buildPackets } from '../server/llm.js'

// --- helpers (shared shape with test/enrich.test.js) -----------------------

function rec({ account, actual, budget = null, accountType = 'expense', category = 'unfavorable', sourceRows = [] }) {
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
    sourceRows
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

function supporting({ fileName, type = 'General Ledger (GL)', columns, rows }) {
  return { fileName, status: 'ok', classification: { type }, normalized: { columns, rows } }
}

// Every enrichable note across the period's sections, so a test never depends on
// whether a given line landed in High Variances vs Expense Notes.
function allNotes(narrative) {
  const p = narrative.periods[0]
  return [...p.highVariances, ...p.revenueNotes, ...p.expenseNotes]
}

// --- Candidate B: broadened header recognition (account column not col 0) ---

test('a "Ledger" header (not column 0) is selected as the account column', () => {
  const idx = buildEvidenceIndex([
    supporting({ fileName: 'gl.xlsx', columns: ['Amount', 'Ledger'], rows: [['18000', 'HVAC Contract']] })
  ])
  assert.equal(idx.length, 1, 'the row indexes by name instead of defaulting to the numeric Amount column')
  assert.equal(idx[0].normName, 'hvac contract')
  assert.equal(scoreMatch('HVAC Contract', idx[0]), 0.9)
})

test('a "Code" header (not column 0) is selected as the account column', () => {
  const idx = buildEvidenceIndex([
    supporting({ fileName: 'gl.xlsx', columns: ['Amount', 'Code'], rows: [['9000', 'Janitorial Contract']] })
  ])
  assert.equal(idx.length, 1)
  assert.equal(idx[0].normName, 'janitorial contract')
})

// --- Candidate A: numeric-only account cell borrows a memo/description label -

test('a numeric-only account cell borrows the Memo column for its label', () => {
  const idx = buildEvidenceIndex([
    supporting({
      fileName: 'gl.xlsx',
      columns: ['Account', 'Memo', 'Vendor', 'Amount'],
      rows: [['6250', 'HVAC Contract', 'Climate Control Inc', '6000']]
    })
  ])
  assert.equal(idx.length, 1)
  assert.equal(idx[0].normName, 'hvac contract')
  // The bare code is preserved for code-tier matching, even though the name was
  // borrowed from the Memo column.
  assert.equal(idx[0].code, '6250')
  // The amount and vendor still resolve from their own columns.
  const cites = matchAccount('HVAC Contract', idx)
  assert.equal(cites.length, 1)
  assert.equal(cites[0].thick, true)
  assert.equal(cites[0].detail.total, 6000)
})

// --- multi-match selection: a code column never beats a name column ----------

test('"Account No" (codes) loses to "Account Name" (names) when both look account-like', () => {
  const idx = buildEvidenceIndex([
    supporting({
      fileName: 'gl.xlsx',
      columns: ['Account No', 'Account Name', 'Amount'],
      rows: [
        ['6420', 'Security Contract', '4000'],
        ['6421', 'Security Patrol', '500']
      ]
    })
  ])
  assert.deepEqual(idx.map((e) => e.normName), ['security contract', 'security patrol'])
  assert.equal(matchAccount('Security Contract', idx).length, 1)
})

// --- regression guard: a bare code with nothing to borrow is still skipped ---

test('a numeric-only account cell with no label column to borrow from is skipped', () => {
  const idx = buildEvidenceIndex([
    supporting({ fileName: 'gl.xlsx', columns: ['Account', 'Amount'], rows: [['6250', '18000']] })
  ])
  assert.equal(idx.length, 0, 'a pure code with no name anywhere must not be indexed as an account')
})

test('an ordinary text account column is unchanged (single match, no fallback)', () => {
  const idx = buildEvidenceIndex([
    supporting({ fileName: 'gl.xlsx', columns: ['Account', 'Amount'], rows: [['Utility Expense Recovery', '7366']] })
  ])
  assert.equal(idx.length, 1)
  assert.equal(idx[0].normName, 'utility expense recovery')
})

// --- end-to-end: the accounts that previously got no GL rows now flow through

const CONTRACT_FLAGGED = [
  rec({ account: 'HVAC Contract', actual: 18000, budget: 12000, sourceRows: [1] }),
  rec({ account: 'Janitorial Contract', actual: 9000, budget: 4500, sourceRows: [2] }),
  rec({ account: 'Security Contract', actual: 7000, budget: 3000, sourceRows: [3] })
]

// A bare-code GL: the account column is numeric, the name is in Memo, the vendor
// and amount are in their own columns — exactly the layout that produced the
// "absence of supporting GL detail rows" message before this fix.
const CONTRACT_GL = supporting({
  fileName: 'General Ledger.pdf',
  columns: ['Account', 'Memo', 'Vendor', 'Amount'],
  rows: [
    ['6250', 'HVAC Contract', 'Climate Control Inc', '6000'],
    ['6310', 'Janitorial Contract', 'CleanCo Services', '4500'],
    ['6420', 'Security Contract', 'SecureGuard LLC', '4000']
  ]
})

test('bare-code GL: each contract account is enriched with support + prepared evidence', () => {
  const enriched = enrichNarrative(baseNarrative(CONTRACT_FLAGGED), { supporting: [CONTRACT_GL] })
  for (const account of ['HVAC Contract', 'Janitorial Contract', 'Security Contract']) {
    const note = allNotes(enriched).find((n) => n.account === account)
    assert.ok(note, `${account} note exists`)
    assert.equal(note.enriched, true, `${account} is enriched`)
    assert.ok(Array.isArray(note.support) && note.support.length >= 1, `${account} has support`)
    assert.ok(note.preparedEvidence, `${account} has prepared evidence`)
    assert.ok(note.preparedEvidence.glRows.length >= 1, `${account} prepared GL rows`)
  }
})

test('bare-code GL: _buildPackets emits non-empty glRows for each contract account', () => {
  const enriched = enrichNarrative(baseNarrative(CONTRACT_FLAGGED), { supporting: [CONTRACT_GL] })
  const packets = _buildPackets(allNotes(enriched), 'current')
  for (const account of ['HVAC Contract', 'Janitorial Contract', 'Security Contract']) {
    const packet = packets.find((p) => p.account === account)
    assert.ok(packet, `${account} produced an evidence packet`)
    assert.ok(packet.glRows.length >= 1, `${account} packet carries GL rows`)
    // The row should carry the real amount and the vendor from the GL.
    assert.ok(packet.glRows.some((r) => r.amount !== null), `${account} packet has an amount`)
  }
})

test('bare-code GL enrichment carries no causation / implied-causation language', () => {
  const enriched = enrichNarrative(baseNarrative(CONTRACT_FLAGGED), { supporting: [CONTRACT_GL], mode: 'detailed' })
  const forbidden = [/primarily due to/i, /\bdue to\b/i, /caused by/i, /driven by/i, /because of/i, /resulting from/i, /\bexplains\b/i]
  for (const note of allNotes(enriched)) {
    for (const re of forbidden) {
      assert.doesNotMatch(note.text, re, `forbidden ${re} in: ${note.text}`)
    }
  }
})
