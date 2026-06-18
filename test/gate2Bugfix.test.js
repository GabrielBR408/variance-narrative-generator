// Gate 2 bugfix triage tests — release-blocking acceptance fixes.
// Runs on Node's built-in test runner (`node --test`).
//
// Covers the three findings from user acceptance testing after PR #31:
//   2. Owner-facing detailed commentary must not use the "GL Detail" label.
//   3. The Excel export carries the ENTIRE variance report (all rows), with the
//      threshold governing only whether a row is narrated — below-threshold rows
//      still appear with a blank narrative/commentary.
//   1. Supporting GL files explain actual activity only; they never produce a
//      standalone budget comparison of their own.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeVariance } from '../src/lib/variance/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'
import { buildOwnerRows } from '../src/lib/export/excel.js'
import { buildGenerateResponse } from '../server/generate.js'

// --- shared fixtures -------------------------------------------------------

// A small but representative base income statement: one row that crosses the
// threshold, one comfortably below it, one missing a comparison, and a rollup.
const BASE_EXTRACTION = {
  fileId: 'base',
  fileName: 'Comparative Income Statement.xlsx',
  status: 'ok',
  confidence: 95,
  classification: { type: 'Base Variance Report' },
  normalized: {
    columns: ['Account', 'Actual', 'Budget'],
    rows: [
      ['Repairs & Maintenance', '5000', '1000'], // var 4000 / 400% → triggered
      ['Office Supplies', '520', '500'], // var 20 / 4% → below threshold
      ['Rental Income', '300', ''], // missing comparison
      ['Total Expenses', '5520', '1500'] // rollup line
    ]
  }
}

// A GL supporting file whose accounts are deliberately NOT in the base report,
// so we can prove the GL is never variance-/budget-compared on its own.
const GL_SUPPORTING = {
  fileName: 'General Ledger.pdf',
  status: 'ok',
  classification: { type: 'General Ledger (GL)' },
  normalized: {
    columns: ['Account', 'Vendor', 'Amount'],
    rows: [
      ['Repairs & Maintenance', 'Acme Plumbing', '3000.25'],
      ['Repairs & Maintenance', 'Acme Plumbing', '1999.75'],
      ['Some GL-Only Account', 'Nobody Co', '900.00']
    ]
  }
}

function narrativeFor(thresholds) {
  return generateNarrative(computeVariance(BASE_EXTRACTION, thresholds))
}

// --- Finding 2: no "GL Detail" label in owner-facing commentary ------------

test('owner-facing detailed commentary does not contain "GL Detail shows"', () => {
  const base = narrativeFor({ amount: 1000, percent: 10 })
  for (const mode of ['detailed', 'conservative']) {
    const enriched = enrichNarrative(base, { supporting: [GL_SUPPORTING], mode })
    const texts = enriched.periods.flatMap((p) => p.highVariances.map((n) => n.text))
    assert.ok(texts.length > 0, `expected at least one enriched note in ${mode} mode`)
    for (const text of texts) {
      assert.doesNotMatch(text, /GL detail shows/i, `"${text}" leaked the GL Detail label`)
      // The internal "GL detail" reference label must not appear in any form.
      assert.doesNotMatch(text, /\bGL detail\b/i, `"${text}" leaked the GL Detail label`)
    }
  }
})

test('the GL evidence sentence still reads naturally (owner-facing) after relabeling', () => {
  const base = narrativeFor({ amount: 1000, percent: 10 })
  const enriched = enrichNarrative(base, { supporting: [GL_SUPPORTING], mode: 'detailed' })
  const repairs = enriched.periods[0].highVariances.find((n) => /Repairs/.test(n.account))
  assert.ok(repairs, 'Repairs note is present and enriched')
  // NQ-1A: owner-facing prose, never the old extraction-style "Detail …" label.
  assert.doesNotMatch(repairs.text, /Detail (shows|includes|reflects)|Detailed (activity|account)/)
  // NQ-2A.1: a single owner-facing explanation sentence (S2).
  assert.match(repairs.text, /(reflects|activity|movement|variance)\b/i)
})

// --- Finding 3: the export carries the entire variance report --------------

test('export includes below-threshold variance rows', () => {
  const rows = buildOwnerRows(narrativeFor({ amount: 1000, percent: 10 }))
  const accounts = rows.map((r) => r.account)
  // Every line of the base report is present — not only the triggered one.
  assert.ok(accounts.includes('Repairs & Maintenance'))
  assert.ok(accounts.includes('Office Supplies'), 'below-threshold row is included')
  assert.ok(accounts.includes('Rental Income'), 'missing-data row is included')
  assert.ok(accounts.includes('Total Expenses'), 'rollup row is included')
  assert.equal(rows.length, 4)

  // The below-threshold row appears with blank narrative + supporting fields.
  const below = rows.find((r) => r.account === 'Office Supplies')
  assert.equal(below.section, 'Within Threshold')
  assert.equal(below.narrative, '')
  assert.equal(below.supporting, '')
  // …but it still carries its real figures, so the report is complete.
  assert.equal(below.actual, 520)
  assert.equal(below.comparison, 500)
  assert.equal(below.varianceAmount, 20)
})

test('threshold controls narrative generation only, not export inclusion', () => {
  // Same report, two very different thresholds. The set of EXPORTED rows is
  // identical; only which rows carry a narrative changes.
  const low = buildOwnerRows(narrativeFor({ amount: 1000, percent: 10 }))
  const high = buildOwnerRows(narrativeFor({ amount: 100000, percent: 10000 }))

  assert.deepEqual(
    low.map((r) => r.account),
    high.map((r) => r.account),
    'the exported rows must not depend on the threshold'
  )

  // Under the low threshold, Repairs is narrated; under the high threshold the
  // SAME row still exports but with a blank narrative.
  const lowRepairs = low.find((r) => r.account === 'Repairs & Maintenance')
  const highRepairs = high.find((r) => r.account === 'Repairs & Maintenance')
  assert.ok(lowRepairs.narrative.length > 0, 'narrated when it crosses the threshold')
  assert.equal(lowRepairs.section, 'High Variance')
  assert.equal(highRepairs.narrative, '', 'not narrated when below the threshold')
  assert.equal(highRepairs.section, 'Within Threshold')
})

// --- Finding 1: GL supports actual activity only, never a standalone compare -

test('GL supporting files do not create standalone budget comparisons', async () => {
  const files = [
    { name: 'Comparative Income Statement.xlsx', size: 10, type: '', role: 'baseReport' },
    { name: 'General Ledger.pdf', size: 10, type: '', role: 'supportingFile' }
  ]
  const variance = { dollarThreshold: '1000', percentThreshold: '10' }

  const withGL = await buildGenerateResponse({
    files,
    extractions: { base: BASE_EXTRACTION, supporting: [GL_SUPPORTING] },
    variance
  })
  const baseOnly = await buildGenerateResponse({
    files: [files[0]],
    extractions: { base: BASE_EXTRACTION, supporting: [] },
    variance
  })

  assert.equal(withGL.status, 200)
  // The variance is computed from the BASE report only: adding the GL changes
  // nothing about the comparison set.
  assert.deepEqual(withGL.body.variance, baseOnly.body.variance)

  // The GL's own accounts are never variance-/budget-compared as their own rows.
  const comparedAccounts = withGL.body.variance.comparisons.map((c) => c.account)
  assert.ok(!comparedAccounts.includes('Some GL-Only Account'), 'GL-only account is not compared')
  // Every compared account traces back to the base report.
  const baseAccounts = new Set(BASE_EXTRACTION.normalized.rows.map((r) => r[0]))
  for (const account of comparedAccounts) {
    assert.ok(baseAccounts.has(account), `compared account "${account}" came from the base report`)
  }
})
