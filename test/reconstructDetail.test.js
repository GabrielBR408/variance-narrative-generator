// GL detail reconstruction tests — Phase 21.1.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
// Exercises the pure post-extraction reconstructor on REAL MRI Description blobs
// (captured from 4. General Ledger.pdf). Asserts: reversibility (the original is
// preserved verbatim), no input mutation, and no date/reference/money/page-bleed
// leakage into the recovered vendor or memo.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { reconstructDetail, VENDOR_MAX_LEN, MEMO_MAX_LEN } from '../src/lib/enrich/reconstructDetail.js'

// Real Description strings from the MRI GL (Vendor column came back empty).
const REAL = [
  { account: '54110 Real Estate Taxes', desc: '1304 4/7/2026 0134 001 2nd Installment 25-26 SAN FRANCISCO TAX COLLECTOR', vendor: 'San Francisco Tax Collector' },
  { account: '51252 Janitorial Supplies', desc: '3506 4/26 Janitorial supply TRINITY BUILDING SERVICES', vendor: 'Trinity Building Services', memo: 'Janitorial supply' },
  { account: '51013 Utility-Elect-Building', desc: '1315 4/20/2026 2/9-3/10/26 7867 Elec & gas PG&E', vendor: 'PG&E', memo: 'Elec & gas' },
  { account: '51153 HVAC-Repairs', desc: '1302 4/6/2026 3/26 HVAC Repair BAY CITY MECHANICAL SERVICE LLC', vendor: 'Bay City Mechanical Service LLC', memo: 'HVAC Repair' },
  { account: '51501 Plumbing Repairs', desc: "1326 4/27/2026 8/25 Plumbing rx (remaining) HEISE'S PLUMBING", vendor: "Heise's Plumbing" },
  { account: '51256 Trash Removal', desc: '1310 4/20/2026 3/26 Trash svc RECOLOGY GOLDEN GATE', vendor: 'Recology Golden Gate', memo: 'Trash svc' },
  { account: '51301 Landscaping Contract', desc: '1303 4/6/2026 4/26 Landscaping Contract FOLIATE LLC', vendor: 'Foliate LLC', memo: 'Landscaping Contract' },
  { account: '51051 Security Contract', desc: '1298 4/6/2026 3/26 Security Svc ARMADA SECURITY', vendor: 'Armada Security', memo: 'Security Svc' },
  { account: '54110 Real Estate Taxes', desc: '04/26 Property Insurance Expense', vendor: null, memo: 'Property Insurance Expense' }, // accrual, no vendor
  { account: '40460 Lease Term Concessions', desc: 'Rentup CON Lease Term Concession', vendor: null, memo: 'Lease Term Concession' }, // posting marker, no vendor
  { account: '54110 Real Estate Taxes', desc: '1305 4/7/2026 0134 032 2nd Installment 25-26 SAN 3,615.91 FRANCISCO TAX COLLECTOR General Ledger', vendor: 'Francisco Tax Collector' } // page-bleed + stray amount
]

const DATE_RE = /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/
const REF_RE = /\b(inv|invoice|chk|check|ck|ref|po|ap|ar|doc|gs|cm|je)\b\s*\d|#\s*\d/i
const MONEY_RE = /\d[\d,]*\.\d{2}\b|\$\s*\d/
const BLEED_RE = /general\s+ledger/i

// --- vendor / memo recovery on real blobs ----------------------------------

test('recovers vendor (and memo where clean) from real MRI Description blobs', () => {
  for (const r of REAL) {
    const out = reconstructDetail({ vendor: '', description: r.desc, account: r.account })
    assert.equal(out.vendor, r.vendor, `vendor for: ${r.desc}`)
    if (r.memo) assert.equal(out.cleanMemo, r.memo, `memo for: ${r.desc}`)
  }
})

// --- reversibility: the original description is preserved verbatim ----------

test('originalDescription is preserved verbatim (reversible)', () => {
  for (const r of REAL) {
    const out = reconstructDetail({ vendor: '', description: r.desc, account: r.account })
    assert.equal(out.originalDescription, r.desc)
  }
})

// --- no mutation of inputs --------------------------------------------------

test('reconstruction never mutates its inputs', () => {
  const input = { vendor: '', description: '1302 4/6/2026 HVAC Repair BAY CITY MECHANICAL SERVICE LLC', account: '51153 HVAC-Repairs' }
  const snapshot = JSON.stringify(input)
  reconstructDetail(input)
  assert.equal(JSON.stringify(input), snapshot)
})

// --- no leakage into vendor / memo -----------------------------------------

test('no date / reference / money / page-bleed survives into vendor or memo', () => {
  for (const r of REAL) {
    const out = reconstructDetail({ vendor: '', description: r.desc, account: r.account })
    for (const field of [out.vendor, out.cleanMemo]) {
      if (field == null) continue
      assert.doesNotMatch(field, DATE_RE, `date leaked: ${field}`)
      assert.doesNotMatch(field, REF_RE, `reference leaked: ${field}`)
      assert.doesNotMatch(field, MONEY_RE, `money leaked: ${field}`)
      assert.doesNotMatch(field, BLEED_RE, `page-bleed leaked: ${field}`)
    }
  }
})

// --- "25-26" fiscal range is treated as date-like and rejected from memo ----

test('a fiscal-year range that looks date-like is rejected from the memo', () => {
  const out = reconstructDetail({ vendor: '', description: REAL[0].desc, account: REAL[0].account })
  assert.equal(out.vendor, 'San Francisco Tax Collector')
  assert.equal(out.cleanMemo, null) // "2nd Installment 25-26" → 25-26 trips the date guard → rejected
})

// --- reconstruct only when the typed vendor is empty ------------------------

test('a provided (non-empty) vendor is preserved and never overwritten', () => {
  const out = reconstructDetail({ vendor: 'Acme Co', description: 'whatever ACME', account: 'X' })
  assert.equal(out.vendor, 'Acme Co')
  assert.equal(out.reconstructed, false)
  assert.equal(out.extractionConfidence, 'provided')
})

test('a null/undefined typed vendor counts as empty and triggers reconstruction', () => {
  // summarizeDetail yields `null` when the Vendor column is empty (real MRI case).
  for (const v of [null, undefined, '']) {
    const out = reconstructDetail({ vendor: v, description: '3506 4/26 Janitorial supply TRINITY BUILDING SERVICES', account: 'X' })
    assert.equal(out.vendor, 'Trinity Building Services', `vendor=${String(v)}`)
    assert.equal(out.reconstructed, true)
    assert.notEqual(out.extractionConfidence, 'provided')
  }
})

// --- length caps & empty input ---------------------------------------------

test('vendor and memo respect length caps; empty description is safe', () => {
  const longVendor = 'X'.repeat(60).split('').join(' ') // many tokens, none vendor-ish
  const out = reconstructDetail({ vendor: '', description: longVendor, account: 'X' })
  if (out.vendor) assert.ok(out.vendor.length <= VENDOR_MAX_LEN)
  if (out.cleanMemo) assert.ok(out.cleanMemo.length <= MEMO_MAX_LEN)

  const empty = reconstructDetail({ vendor: '', description: '', account: 'X' })
  assert.equal(empty.vendor, null)
  assert.equal(empty.cleanMemo, null)
  assert.equal(empty.originalDescription, '')
})

// --- determinism -----------------------------------------------------------

test('reconstruction is deterministic', () => {
  const args = { vendor: '', description: REAL[3].desc, account: REAL[3].account }
  assert.deepEqual(reconstructDetail(args), reconstructDetail({ ...args }))
})
