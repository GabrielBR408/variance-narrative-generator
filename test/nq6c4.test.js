// NQ-6C.4 tests — PDF GL Parser (text fallback)
//
// A sectioned PDF General Ledger whose pdf.js x-positions don't resolve into
// clean Debit/Credit bands used to read as "No content" (the position-based
// reconstructor returned null and nothing else parsed it). NQ-6C.4 adds a
// position-INDEPENDENT text reconstructor that parses the x-sorted line STRINGS
// via section markers — "<code> <Name>" account headings, "Balance Forward",
// and "** Account Totals" — and emits the SAME typed GL table the position-based
// path produces, so the evidence index/enrichment/LLM packets consume it the
// same way. The XLSX sectioned parser and the position-based PDF parser are
// untouched (covered by their own suites).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  reconstructTable,
  reconstructSectionedGLFromText,
  looksLikeSectionedGLText,
  GL_COLUMNS
} from '../src/lib/extract/pdfTable.js'
import { normalize } from '../src/lib/extract/normalize.js'
import { buildEvidenceIndex, matchAccount } from '../src/lib/enrich/match.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'

// --- fixtures --------------------------------------------------------------

// x-sorted text lines from a sectioned PDF GL: a repeated column header (chrome),
// then account sections — heading, Balance Forward marker, transactions, and a
// "** Account Totals" line that must never be mined as a transaction.
const GL_HEADER = 'Period Entry Date Src Reference Description Debit Credit Balance'
function glTextLines() {
  return [
    GL_HEADER,
    '51053 HVAC Contract',
    'Balance Forward 0.00',
    '29298 01/26 01/15/2026 CHK1042 Monthly HVAC service ABC Mechanical 3000.00 0.00 3000.00',
    '29298 01/26 02/15/2026 CHK1099 Monthly HVAC service ABC Mechanical 3000.00 0.00 6000.00',
    '** Account Totals 6000.00 0.00 6000.00',
    '51051 Security Contract',
    'Balance Forward 0.00',
    '29298 01/26 01/20/2026 CHK1200 Monthly security SecureGuard LLC 4000.00 0.00 4000.00',
    '** Account Totals 4000.00 0.00 4000.00',
    '51052 Janitorial Contract',
    'Balance Forward 0.00',
    '29298 01/26 01/31/2026 CHK1100 Janitorial service CleanCo Services 4500.00 0.00 4500.00',
    '** Account Totals 4500.00 0.00 4500.00'
  ]
}

function asMapped(row) {
  const out = {}
  GL_COLUMNS.forEach((col, i) => (out[col] = row[i]))
  return out
}

const CONTRACTS = ['HVAC Contract', 'Janitorial Contract', 'Security Contract']

// --- detection -------------------------------------------------------------

test('looksLikeSectionedGLText recognizes GL markers, rejects a variance report', () => {
  assert.equal(looksLikeSectionedGLText(glTextLines()), true)
  // "** Account Totals" alone is enough.
  assert.equal(looksLikeSectionedGLText(['5100 Repairs', '** Account Totals 10.00 0.00 10.00']), true)
  // A variance report carries neither marker.
  const variance = ['Account Actual Budget Variance YTD Actual YTD Budget YTD Variance', 'Repairs 10 5 5 20 10 10']
  assert.equal(looksLikeSectionedGLText(variance), false)
  assert.equal(looksLikeSectionedGLText(['just some prose', 'nothing tabular']), false)
})

// --- text reconstruction ---------------------------------------------------

test('reconstructSectionedGLFromText flattens sections to one transaction per row', () => {
  const table = reconstructSectionedGLFromText(glTextLines())
  assert.equal(table.name, 'Reconstructed GL')
  assert.deepEqual(table.rows[0], GL_COLUMNS.slice())
  const data = table.rows.slice(1).map(asMapped)
  assert.equal(data.length, 4) // 2 HVAC + 1 Security + 1 Janitorial; totals/markers excluded
  assert.deepEqual(data.map((r) => r.Account), [
    '51053 HVAC Contract',
    '51053 HVAC Contract',
    '51051 Security Contract',
    '51052 Janitorial Contract'
  ])
  // First HVAC transaction: date, reference, memo, and a positive (debit) amount.
  assert.equal(data[0].Date, '01/15/2026')
  assert.equal(data[0].Reference, 'CHK1042')
  assert.equal(data[0].Description, 'Monthly HVAC service ABC Mechanical')
  assert.equal(data[0].Amount, '3000')
  // No "** Account Totals" or "Balance Forward" leaked into a row.
  for (const r of data) assert.doesNotMatch(`${r.Account} ${r.Description}`, /balance forward|account totals/i)
})

test('debit nets positive, credit nets negative (amount = debit if >0 else -credit)', () => {
  const table = reconstructSectionedGLFromText([
    '5100 Repairs',
    'Balance Forward 0.00',
    '29298 01/26 03/01/2026 INV100 Roof repair 1200.00 0.00 1200.00',
    '29298 01/26 03/05/2026 CR200 Vendor refund 0.00 250.00 950.00',
    '** Account Totals 1200.00 250.00 950.00'
  ])
  const data = table.rows.slice(1).map(asMapped)
  assert.equal(data[0].Amount, '1200')
  assert.equal(data[1].Amount, '-250')
})

test('an account heading on the same line as Balance Forward is captured (MRI form)', () => {
  const table = reconstructSectionedGLFromText([
    '54110 Real Estate Taxes Balance Forward 0.00',
    '29298 01/26 4/30/2026 GS 00084362 Accrued RE Tax 75242.55 0.00 75242.55'
  ])
  const r = asMapped(table.rows[1])
  assert.equal(r.Account, '54110 Real Estate Taxes')
  assert.equal(r.Reference, 'GS 00084362')
  assert.equal(r.Amount, '75242.55')
})

test('transactions with no Balance column still net from Debit/Credit', () => {
  const table = reconstructSectionedGLFromText([
    '5200 Cleaning',
    'Balance Forward',
    '29298 01/26 02/02/2026 CHK9 Monthly clean 800.00 0.00'
  ])
  assert.equal(asMapped(table.rows[1]).Amount, '800')
})

// --- routing through reconstructTable --------------------------------------

test('reconstructTable uses the text fallback when no lineCells are available', () => {
  // GL by classification, but no position-aware cells → text path.
  const table = reconstructTable(glTextLines(), { classificationType: 'General Ledger (GL)' })
  assert.equal(table.name, 'Reconstructed GL')
  assert.equal(table.rows.length - 1, 4)
})

test('reconstructTable routes by content alone (no classification) via GL markers', () => {
  const table = reconstructTable(glTextLines(), {})
  assert.ok(table && table.name === 'Reconstructed GL')
})

test('a non-GL / unparseable PDF text fails silently (null, no error)', () => {
  assert.equal(reconstructSectionedGLFromText(['Some prose', 'No ledger here']), null)
  assert.equal(reconstructSectionedGLFromText([]), null)
  // Routed as GL by classification but with no parseable sections → falls through
  // (variance reconstructor also returns null) → no table.
  assert.equal(reconstructTable(['nothing useful'], { classificationType: 'General Ledger (GL)' }), null)
})

// --- evidence index + matching ---------------------------------------------

test('the PDF GL text rows index and match the three contract accounts', () => {
  const table = reconstructTable(glTextLines(), { classificationType: 'General Ledger (GL)' })
  const { normalized } = normalize({ tables: [table] }, 'pdf')
  assert.deepEqual(normalized.columns, GL_COLUMNS.slice())
  const idx = buildEvidenceIndex([{ fileName: 'YTD GL.pdf', status: 'ok', classification: { type: 'General Ledger (GL)' }, normalized }])
  assert.equal(idx.length, 4)
  const totals = { 'HVAC Contract': 6000, 'Janitorial Contract': 4500, 'Security Contract': 4000 }
  for (const account of CONTRACTS) {
    const cites = matchAccount(account, idx)
    assert.equal(cites.length, 1, `${account} has a citation`)
    assert.equal(cites[0].confidence, 0.9)
    assert.equal(cites[0].thick, true)
    assert.equal(cites[0].detail.total, totals[account], `${account} total`)
  }
})

// --- end-to-end enrichment --------------------------------------------------

function rec({ account, actual, budget }) {
  const varianceAmount = actual - budget
  return {
    account,
    actual,
    budget,
    prior: null,
    varianceAmount,
    variancePercent: budget === 0 ? null : (varianceAmount / Math.abs(budget)) * 100,
    comparisonType: 'budget',
    thresholdTriggered: true,
    category: 'unfavorable',
    accountType: 'expense',
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

test('enrichNarrative: a PDF GL enriches each contract note with GL support + prepared rows', () => {
  const table = reconstructTable(glTextLines(), { classificationType: 'General Ledger (GL)' })
  const { normalized } = normalize({ tables: [table] }, 'pdf')
  const gl = { fileName: 'YTD GL.pdf', status: 'ok', classification: { type: 'General Ledger (GL)' }, normalized }
  const flagged = [
    rec({ account: 'HVAC Contract', actual: 18000, budget: 12000 }),
    rec({ account: 'Janitorial Contract', actual: 9000, budget: 4500 }),
    rec({ account: 'Security Contract', actual: 7000, budget: 3000 })
  ]
  const enriched = enrichNarrative(baseNarrative(flagged), { supporting: [gl] })
  for (const account of CONTRACTS) {
    const note = allNotes(enriched).find((n) => n.account === account)
    assert.ok(note && note.enriched, `${account} is enriched`)
    assert.ok(Array.isArray(note.support) && note.support.length >= 1, `${account} has support`)
    assert.ok(note.preparedEvidence && note.preparedEvidence.glRows.length >= 1, `${account} has prepared GL rows`)
  }
})
