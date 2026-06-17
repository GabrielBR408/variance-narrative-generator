// NQ-4A.1 — Wording + Evidence Surfacing regression tests.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Five small, safe wording rules layered on top of the existing enrichment.
// Nothing here changes the planner, section routing, exports, variance math,
// enrichment architecture, or selection — only the rendered prose:
//   1. Concentration / top-contributor wording (category B) — existing signals.
//   2. Confidence hedging — medium softens the one assertive explanation;
//      high is unchanged.
//   3. Descriptor expansion — leasing / parking / concession / recovery /
//      reimbursement / storage / common area drawn from the account NAME only.
//   4. Borderline materiality wording — adjective only, no threshold change.
//   5. Vendor / memo polish generalization — possessives + standalone ampersand,
//      preserving reject-on-doubt.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  enrichNarrative,
  descriptorFor,
  polishVendor,
  polishMemo,
  finalizeNoteCommentary,
  explanationCommentary,
  BORDERLINE_MATERIAL_MAX,
  MATERIAL_DOLLAR
} from '../src/lib/enrich/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'

// --- helpers ---------------------------------------------------------------

function rec({ account, actual, budget, accountType = 'expense', category = 'unfavorable' }) {
  const varianceAmount = actual - budget
  const variancePercent = budget === 0 ? null : (varianceAmount / Math.abs(budget)) * 100
  return {
    account, actual, budget, prior: null, varianceAmount, variancePercent,
    comparisonType: 'budget', thresholdTriggered: true, category, accountType,
    missingData: false, confidence: 90, sourceRows: [0]
  }
}

const GL_COLUMNS = ['Account', 'Date', 'Reference', 'Vendor', 'Description', 'Amount']

// Enrich a one-account flagged narrative. `rows` are GL [vendor, description,
// amount] triples; vendor may be '' to mine it from the Description blob.
function enriched({ account, actual, budget, accountType, category, rows, mode = 'detailed' }) {
  const narrative = generateNarrative({
    fileId: 'base', fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report', thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{ period: 'current', comparisons: [rec({ account, actual, budget, accountType, category })] }]
  })
  const gl = {
    fileName: '4. General Ledger.pdf', status: 'ok', classification: { type: 'General Ledger (GL)' },
    normalized: {
      columns: GL_COLUMNS,
      // With `rows`, the GL matches the account; without, a different account is
      // supplied so the note is genuinely unmatched (hasCitation = false).
      rows: rows
        ? rows.map(([v, d, a]) => [account, '01/10/2026', '', v, d, String(a)])
        : [['ZZZ Unrelated Account', '01/10/2026', '', '', 'Nothing', '1']]
    }
  }
  const out = enrichNarrative(narrative, { supporting: [gl], mode })
  const p = out.periods[0]
  return p.highVariances.find((x) => x.account === account) ||
    p.revenueNotes.find((x) => x.account === account) ||
    p.expenseNotes.find((x) => x.account === account)
}

function sentenceCount(text) {
  return (String(text).match(/[.!?](?:\s|$)/g) || []).length
}

const FORBIDDEN = [
  /\bdue to\b/i, /caused by/i, /driven by/i, /\bdrove\b/i, /because of/i,
  /resulting from/i, /attributable to/i, /\bwill\b/i, /\bcertainly\b/i,
  /\bdefinitely\b/i, /\bmust\b/i
]
function assertSafe(text) {
  assert.ok(sentenceCount(text) <= 2, `>2 sentences: ${text}`)
  for (const re of FORBIDDEN) assert.doesNotMatch(text, re, `forbidden phrase ${re} in: ${text}`)
}

// =========================================================================
// 1. Concentration / top-contributor wording
// =========================================================================

test('category B surfaces the largest single contributor (existing signals only)', () => {
  // One dominant transaction in a multi-transaction total → top-contributor wording.
  const note = enriched({
    account: 'Repairs Expense', actual: 25000, budget: 5000,
    rows: [['', '', 18000], ['', '', 1000], ['', '', 1000]], mode: 'conservative'
  })
  assert.match(
    note.text,
    /The movement reflects approximately \$20,000 across 3 transactions, with the largest single item about \$18,000 of the total\.$/
  )
  assert.doesNotMatch(note.text, /concentrated in one of about/)
  assertSafe(note.text)
})

// =========================================================================
// 2. Confidence hedging
// =========================================================================

test('high-confidence evidence keeps the assertive "was above/below plan"', () => {
  // Vendor + memo + high-confidence source → high → unchanged assertive wording.
  const note = enriched({
    account: '51252 Janitorial Supplies', actual: 9000, budget: 5000,
    rows: [['', 'Janitorial supply TRINITY BUILDING SERVICES', 4000]]
  })
  assert.match(note.text, /was above plan for the period\.$/)
  assert.doesNotMatch(note.text, /appears to have been/)
  assertSafe(note.text)
})

test('medium-confidence evidence softens to "appears to have been above/below plan"', () => {
  // Vendor-only (no memo) → medium → softened assertion.
  const note = enriched({
    account: '51257 Recology Hauling', actual: 4000, budget: 1000,
    rows: [['', 'RECOLOGY GOLDEN GATE', 3000]]
  })
  assert.match(note.text, /appears to have been above plan for the period\.$/)
  assert.doesNotMatch(note.text, /\bwas above plan\b/)
  assertSafe(note.text)
})

test('hedging never reaches conservative mode', () => {
  const note = enriched({
    account: '51257 Recology Hauling', actual: 4000, budget: 1000,
    rows: [['', 'RECOLOGY GOLDEN GATE', 3000]], mode: 'conservative'
  })
  assert.doesNotMatch(note.text, /appears to have been|plan for the period/)
})

// =========================================================================
// 3. Descriptor expansion (account NAME only)
// =========================================================================

test('descriptorFor recognizes the expanded account families', () => {
  assert.equal(descriptorFor('40460 Lease Term Concessions'), 'concession')
  assert.equal(descriptorFor('CAM Reimbursement'), 'reimbursement')
  assert.equal(descriptorFor('Utility Recovery Income'), 'utility') // utility stays most-specific
  assert.equal(descriptorFor('Tax Recovery'), 'tax') // tax stays most-specific
  assert.equal(descriptorFor('Common Area Charges'), 'common area')
  assert.equal(descriptorFor('Parking Garage Income'), 'parking')
  assert.equal(descriptorFor('Storage Rental'), 'storage')
  assert.equal(descriptorFor('Leasing Commissions'), 'leasing')
  assert.equal(descriptorFor('Tenant Improvements'), 'leasing')
  // Unrecognized names still drop the descriptor rather than guess.
  assert.equal(descriptorFor('Miscellaneous Other'), '')
})

test('an expanded descriptor surfaces in the rendered GL sentence', () => {
  // Aligned quantified-fallback (F) shape: variance == GL total, ratio 0.7,
  // 3 transactions → the F sentence renders the account-name descriptor.
  const note = enriched({
    account: '47000 Parking Income', actual: 6000, budget: 5000,
    accountType: 'expense', // keep the expense path so F renders the descriptor
    rows: [['', '', 700], ['', '', 200], ['', '', 100]], mode: 'conservative'
  })
  assert.match(note.text, /related parking transactions/)
  assertSafe(note.text)
})

// =========================================================================
// 4. Borderline materiality wording (adjective only)
// =========================================================================

test('a just-material unexplained variance reads as borderline material', () => {
  const note = enriched({ account: '51600 Fire/Life Safety-Other', actual: 16000, budget: 5000 }) // $11,000 < ceiling
  assert.match(note.text, /This is a borderline material variance and should be reviewed with supporting detail\.$/)
  assertSafe(note.text)
})

test('a clearly material unexplained variance stays plainly material', () => {
  const note = enriched({ account: '51600 Fire/Life Safety-Other', actual: 30000, budget: 5000 }) // $25,000 ≥ ceiling
  assert.match(note.text, /This is a material variance and should be reviewed with supporting detail\.$/)
  assert.doesNotMatch(note.text, /borderline/)
})

test('borderline wording does not change the flagging threshold', () => {
  // The band sits strictly above the materiality floor and below the ceiling.
  assert.ok(BORDERLINE_MATERIAL_MAX > MATERIAL_DOLLAR)
  // A sub-material line is still not flagged at all (no review sentence).
  const note = finalizeNoteCommentary({ note: { varianceAmount: 8000 }, glSentence: null, hasCitation: false })
  assert.equal(note, null)
})

// =========================================================================
// 5. Vendor / memo polish generalization
// =========================================================================

test('polishVendor rejoins a dropped possessive for an unseen vendor', () => {
  assert.equal(polishVendor('Diaz S Landscaping'), "Diaz's Landscaping")
  // A single-letter initial is NOT treated as a possessive.
  assert.equal(polishVendor('J S Smith'), 'J S Smith')
  // Existing canonical and conservative behavior is preserved.
  assert.equal(polishVendor('ACME WIDGETS INC.'), 'Acme Widgets Inc.')
  assert.equal(polishVendor("Heise's Plumbing"), "Heise's Plumbing")
})

test('polishMemo expands a standalone ampersand but preserves embedded acronyms', () => {
  // polishMemo only lowercases the leading letter (interior casing, often a
  // proper noun, is preserved by design); the spaced "&" expands to "and".
  assert.equal(polishMemo('Repairs & Grounds'), 'repairs and Grounds')
  assert.equal(polishMemo('AT&T service'), 'AT&T service') // leading acronym preserved, no spaced &
  assert.equal(polishMemo('Monthly water'), 'monthly water') // unchanged general path
})
