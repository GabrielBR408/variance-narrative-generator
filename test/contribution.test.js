// --- Contribution ranking unit tests — Phase 19B --------------------------
// Pure-function coverage of rankContribution: ratio bands, offset guard,
// direction guard (expense/revenue/unknown), the vendor/description
// renderability gates, and determinism. Runs on `node --test`, no deps.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { rankContribution } from '../src/lib/enrich/contribution.js'

// Build a contribution input. `detail` defaults keep a clean reliable total.
function input({
  varianceAmount = 1000,
  accountType = 'unknown',
  category = 'neutral',
  total = 1000,
  maxTxn = null,
  count = 1,
  vendor = null,
  description = null,
  confidence = 0.9
} = {}) {
  return {
    varianceAmount,
    comparisonType: 'budget',
    accountType,
    category,
    detail: { total, maxTxn, count, vendor, description, confidence }
  }
}

// --- ratio bands -----------------------------------------------------------

test('ratio bands map to aligned / partial / disproportionate', () => {
  const r = (varianceAmount, total) => rankContribution(input({ varianceAmount, total, maxTxn: Math.abs(total) }))
  assert.equal(r(1000, 1000).contributionType, 'aligned') // 1.0
  assert.equal(r(1000, 500).contributionType, 'aligned') // 0.50 boundary
  assert.equal(r(1000, 2000).contributionType, 'aligned') // 2.00 boundary
  assert.equal(r(1000, 490).contributionType, 'partial') // 0.49
  assert.equal(r(40000, 1800).contributionType, 'partial') // 0.045
  assert.equal(r(1000, 2010).contributionType, 'disproportionate') // 2.01
  assert.equal(r(2189, 265000).contributionType, 'disproportionate') // 121
})

test('ratio is computed as |total| / |varianceAmount|', () => {
  assert.equal(rankContribution(input({ varianceAmount: 2000, total: 1000, maxTxn: 1000 })).ratio, 0.5)
  assert.equal(rankContribution(input({ varianceAmount: -3000, total: -3000, maxTxn: 3000 })).ratio, 1)
})

// --- offset guard ----------------------------------------------------------

test('a single transaction larger than the net total is offset-heavy', () => {
  // ratio 1.49 would be aligned, but maxTxn > |total| ⇒ offset-heavy wins.
  const out = rankContribution(input({ varianceAmount: 7186, total: 10700, maxTxn: 23200, count: 2 }))
  assert.equal(out.contributionType, 'offset-heavy')
})

test('maxTxn equal to the total is NOT offset-heavy', () => {
  const out = rankContribution(input({ varianceAmount: 1000, total: 1000, maxTxn: 1000 }))
  assert.equal(out.contributionType, 'aligned')
})

// --- direction guard -------------------------------------------------------

test('expense unfavorable with a net credit conflicts', () => {
  const out = rankContribution(input({ accountType: 'expense', category: 'unfavorable', varianceAmount: 3000, total: -5000, maxTxn: 5000 }))
  assert.equal(out.directionAligned, false)
  assert.equal(out.contributionType, 'direction-conflict')
})

test('expense favorable with a net credit is aligned (a genuine true-up)', () => {
  const out = rankContribution(input({ accountType: 'expense', category: 'favorable', varianceAmount: -3000, total: -3000, maxTxn: 3000 }))
  assert.equal(out.directionAligned, true)
  assert.equal(out.contributionType, 'aligned')
})

test('revenue favorable with a net credit is aligned (normal income)', () => {
  const out = rankContribution(input({ accountType: 'revenue', category: 'favorable', varianceAmount: -12000, total: -12000, maxTxn: 12000 }))
  assert.equal(out.directionAligned, true)
  assert.equal(out.contributionType, 'aligned')
})

test('revenue favorable with a net debit conflicts', () => {
  const out = rankContribution(input({ accountType: 'revenue', category: 'favorable', varianceAmount: -3000, total: 6000, maxTxn: 6000 }))
  assert.equal(out.directionAligned, false)
  assert.equal(out.contributionType, 'direction-conflict')
})

test('unknown account type never asserts a direction conflict', () => {
  const out = rankContribution(input({ accountType: 'unknown', category: 'neutral', varianceAmount: 3000, total: -3000, maxTxn: 3000 }))
  assert.equal(out.directionAligned, true)
  assert.equal(out.contributionType, 'aligned')
})

test('direction conflict outranks disproportionate and offset', () => {
  const out = rankContribution(input({ accountType: 'expense', category: 'unfavorable', varianceAmount: 2189, total: -265000, maxTxn: 400000, count: 2 }))
  assert.equal(out.contributionType, 'direction-conflict')
})

// --- reliability -----------------------------------------------------------

test('no reliable total with transactions ⇒ no-reliable-amount', () => {
  const out = rankContribution(input({ total: null, count: 2 }))
  assert.equal(out.contributionType, 'no-reliable-amount')
  assert.equal(out.amountReliable, false)
  assert.equal(out.ratio, null)
})

test('no reliable total and no transactions ⇒ unquantified', () => {
  const out = rankContribution(input({ total: null, count: 0 }))
  assert.equal(out.contributionType, 'unquantified')
})

// --- vendor gates ----------------------------------------------------------

test('vendor renders only when confident, short, non-numeric, non-reference, count <= 3', () => {
  const v = (over) => rankContribution(input({ vendor: 'PG&E', count: 2, confidence: 0.9, ...over })).vendorRenderable
  assert.equal(v(), true)
  assert.equal(v({ confidence: 0.89 }), false) // below 0.90
  assert.equal(v({ vendor: 'X'.repeat(31) }), false) // too long
  assert.equal(v({ vendor: '12345' }), false) // numeric
  assert.equal(v({ vendor: 'AP 064697' }), false) // reference-like
  assert.equal(v({ vendor: 'GS 00084362' }), false) // reference-like
  assert.equal(v({ count: 4 }), false) // too many rows to attribute to one vendor
  assert.equal(v({ vendor: null }), false) // none
})

// --- description gates -----------------------------------------------------

test('description renders only when short, clean, and not reference-like', () => {
  // No vendor present, so description is eligible.
  const d = (over) => rankContribution(input({ vendor: null, description: 'HVAC repair', ...over })).descriptionRenderable
  assert.equal(d(), true)
  assert.equal(d({ description: 'INV #123 furniture' }), false) // reference-like
  assert.equal(d({ description: 'Acme '.repeat(11) }), false) // > 50 chars
  assert.equal(d({ description: 'paid 1,250.00' }), false) // money token
  assert.equal(d({ description: 'service 4/30/2026' }), false) // date token
})

test('vendor and description are never both renderable (vendor wins)', () => {
  const out = rankContribution(input({ vendor: 'PG&E', description: 'HVAC repair', count: 2, confidence: 0.9 }))
  assert.equal(out.vendorRenderable, true)
  assert.equal(out.descriptionRenderable, false)
})

// --- determinism -----------------------------------------------------------

test('rankContribution is pure: identical inputs ⇒ identical output', () => {
  const a = rankContribution(input({ accountType: 'expense', category: 'unfavorable', varianceAmount: 7186, total: 10700, maxTxn: 23200, count: 2, vendor: 'Acme' }))
  const b = rankContribution(input({ accountType: 'expense', category: 'unfavorable', varianceAmount: 7186, total: 10700, maxTxn: 23200, count: 2, vendor: 'Acme' }))
  assert.deepEqual(a, b)
})
