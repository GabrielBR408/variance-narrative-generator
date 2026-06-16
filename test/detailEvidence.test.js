// GL detail evidence selection tests — Phase 21.2.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
// Exercises the pure render-safety gate that sits on top of Phase 21.1
// reconstruction. Asserts: dirty fields rejected (date / reference / money /
// page-bleed / long code / account code), generic one-word vendors rejected,
// generic memos rejected unless paired with a high-confidence vendor, length
// caps enforced, determinism, no mutation of the reconstructed metadata, and —
// end-to-end — that owner narrative output is unchanged by this layer.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  selectDetailEvidence,
  VENDOR_RENDER_MAX_LEN,
  MEMO_RENDER_MAX_LEN
} from '../src/lib/enrich/detailEvidence.js'
import { reconstructDetail } from '../src/lib/enrich/reconstructDetail.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'

// Build a reconstructed-shaped metadata object for direct selector tests.
function recon({ vendor = null, cleanMemo = null, extractionConfidence = 'medium' }) {
  return { vendor, cleanMemo, extractionConfidence, originalDescription: 'x', reconstructed: vendor != null || cleanMemo != null }
}

// --- clean vendors accepted ------------------------------------------------

test('clean, real vendors are accepted', () => {
  for (const v of ['Trinity Building Services', 'PG&E', 'Recology Golden Gate', 'Foliate LLC', "Heise's Plumbing"]) {
    const out = selectDetailEvidence({ reconstructed: recon({ vendor: v }), account: '51252 Janitorial Supplies' })
    assert.equal(out.vendorRenderable, true, `expected accepted: ${v}`)
    assert.equal(out.vendor, v)
  }
})

// --- dirty vendors rejected: date / reference / money / page-bleed / codes --

test('dates, references, money, page-bleed, and long codes are rejected from vendor', () => {
  const cases = [
    { v: 'PG&E 4/20/2026', reason: 'vendor:date' },
    { v: 'Acme INV 884', reason: 'vendor:reference' },
    { v: 'Acme $1,200', reason: 'vendor:money' },
    { v: 'Acme 3,615.91', reason: 'vendor:money' },
    { v: 'Trinity General Ledger', reason: 'vendor:page-bleed' },
    { v: 'Vendor 00084362', reason: 'vendor:long-code' }
  ]
  for (const { v, reason } of cases) {
    const out = selectDetailEvidence({ reconstructed: recon({ vendor: v }), account: 'X' })
    assert.equal(out.vendorRenderable, false, `expected rejected: ${v}`)
    assert.ok(out.rejectionReasons.includes(reason), `expected ${reason} for: ${v} (got ${out.rejectionReasons})`)
    assert.equal(out.vendor, null)
  }
})

// --- raw account code rejected ---------------------------------------------

test('a field echoing the raw account code is rejected', () => {
  const out = selectDetailEvidence({ reconstructed: recon({ vendor: 'Taxes 54110' }), account: '54110 Real Estate Taxes' })
  assert.equal(out.vendorRenderable, false)
  assert.ok(out.rejectionReasons.some((r) => r === 'vendor:account-code' || r === 'vendor:long-code'))
})

// --- generic one-word vendors rejected -------------------------------------

test('generic one-word vendors are rejected', () => {
  for (const v of ['Service', 'Ipa', 'Account', 'General Ledger', 'Expense', 'Accrual']) {
    const out = selectDetailEvidence({ reconstructed: recon({ vendor: v }), account: 'X' })
    assert.equal(out.vendorRenderable, false, `expected generic-rejected: ${v}`)
    assert.ok(
      out.rejectionReasons.includes('vendor:generic') || out.rejectionReasons.includes('vendor:page-bleed'),
      `expected generic/page-bleed for: ${v} (got ${out.rejectionReasons})`
    )
  }
})

// --- useful memo accepted --------------------------------------------------

test('a useful, specific memo is accepted', () => {
  for (const m of ['Janitorial supply', 'HVAC Repair', 'Elec & gas', 'Landscaping Contract']) {
    const out = selectDetailEvidence({ reconstructed: recon({ cleanMemo: m }), account: 'X' })
    assert.equal(out.memoRenderable, true, `expected accepted memo: ${m}`)
    assert.equal(out.memo, m)
  }
})

// --- generic memo rejected unless paired with a high-confidence vendor ------

test('a generic memo is rejected on its own', () => {
  for (const m of ['Service', 'Expense', 'Accrual', 'Invoice', 'Payment', 'invoice payment']) {
    const out = selectDetailEvidence({ reconstructed: recon({ cleanMemo: m }), account: 'X' })
    assert.equal(out.memoRenderable, false, `expected generic-rejected memo: ${m}`)
    assert.ok(out.rejectionReasons.includes('memo:generic-unpaired'))
  }
})

test('a generic memo is accepted when paired with a high-confidence vendor', () => {
  const out = selectDetailEvidence({
    reconstructed: recon({ vendor: 'Trinity Building Services', cleanMemo: 'Invoice', extractionConfidence: 'high' }),
    account: 'X'
  })
  assert.equal(out.vendorRenderable, true)
  assert.equal(out.memoRenderable, true)
  assert.equal(out.evidenceConfidence, 'high')
})

test('a generic memo stays rejected when the paired vendor is not high-confidence', () => {
  const out = selectDetailEvidence({
    reconstructed: recon({ vendor: 'Trinity Building Services', cleanMemo: 'Invoice', extractionConfidence: 'medium' }),
    account: 'X'
  })
  assert.equal(out.vendorRenderable, true)
  assert.equal(out.memoRenderable, false)
  assert.ok(out.rejectionReasons.includes('memo:generic-unpaired'))
})

// --- length caps -----------------------------------------------------------

test('fields exceeding the length caps are rejected', () => {
  const longVendor = 'A'.repeat(VENDOR_RENDER_MAX_LEN + 5)
  const longMemo = 'word ' .repeat(Math.ceil((MEMO_RENDER_MAX_LEN + 10) / 5))
  const v = selectDetailEvidence({ reconstructed: recon({ vendor: longVendor }), account: 'X' })
  assert.equal(v.vendorRenderable, false)
  assert.ok(v.rejectionReasons.includes('vendor:length'))
  const m = selectDetailEvidence({ reconstructed: recon({ cleanMemo: longMemo.trim() }), account: 'X' })
  assert.equal(m.memoRenderable, false)
  assert.ok(m.rejectionReasons.includes('memo:length'))
})

// --- evidence confidence tiers ---------------------------------------------

test('evidenceConfidence reflects what survived selection', () => {
  assert.equal(selectDetailEvidence({ reconstructed: recon({}), account: 'X' }).evidenceConfidence, 'none')
  assert.equal(
    selectDetailEvidence({ reconstructed: recon({ vendor: 'PG&E 4/20/2026' }), account: 'X' }).evidenceConfidence,
    'low'
  )
  assert.equal(
    selectDetailEvidence({ reconstructed: recon({ cleanMemo: 'HVAC Repair' }), account: 'X' }).evidenceConfidence,
    'medium'
  )
  assert.equal(
    selectDetailEvidence({
      reconstructed: recon({ vendor: 'Foliate LLC', cleanMemo: 'Landscaping Contract', extractionConfidence: 'high' }),
      account: 'X'
    }).evidenceConfidence,
    'high'
  )
})

// --- determinism -----------------------------------------------------------

test('selection is deterministic', () => {
  const r = recon({ vendor: 'Bay City Mechanical Service LLC', cleanMemo: 'HVAC Repair', extractionConfidence: 'high' })
  assert.deepEqual(
    selectDetailEvidence({ reconstructed: r, account: '51153 HVAC-Repairs' }),
    selectDetailEvidence({ reconstructed: { ...r }, account: '51153 HVAC-Repairs' })
  )
})

// --- no mutation of the reconstructed metadata -----------------------------

test('selection never mutates the reconstructed metadata', () => {
  const r = reconstructDetail({ vendor: '', description: '1302 4/6/2026 HVAC Repair BAY CITY MECHANICAL SERVICE LLC', account: '51153 HVAC-Repairs' })
  const snapshot = JSON.stringify(r)
  selectDetailEvidence({ reconstructed: r, account: '51153 HVAC-Repairs' })
  assert.equal(JSON.stringify(r), snapshot)
})

// --- chained with real reconstruction --------------------------------------

test('end-to-end on a real MRI blob: vendor recovered and accepted', () => {
  const r = reconstructDetail({ vendor: '', description: '3506 4/26 Janitorial supply TRINITY BUILDING SERVICES', account: '51252 Janitorial Supplies' })
  const out = selectDetailEvidence({ reconstructed: r, account: '51252 Janitorial Supplies' })
  assert.equal(out.vendor, 'Trinity Building Services')
  assert.equal(out.vendorRenderable, true)
  assert.equal(out.memo, 'Janitorial supply')
  assert.equal(out.memoRenderable, true)
})

// --- owner narrative output is unchanged by this layer ---------------------
// Builds the same GL-enriched narrative used elsewhere and asserts the rendered
// Markdown is byte-identical whether or not the `detailEvidence` metadata is
// stripped from the support entries — i.e. nothing on the render path reads it.

function buildEnriched() {
  const comparisons = [
    {
      account: 'Utility-Building Water', actual: 3100, budget: 1000, prior: null,
      varianceAmount: 2100, variancePercent: 210, comparisonType: 'budget',
      thresholdTriggered: true, category: 'unfavorable', accountType: 'expense',
      missingData: false, confidence: 90, sourceRows: [0]
    }
  ]
  const narrative = generateNarrative({
    fileId: 'base',
    fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{ period: 'current', comparisons }]
  })
  const gl = {
    fileName: '4. General Ledger.pdf',
    status: 'ok',
    classification: { type: 'General Ledger (GL)' },
    normalized: {
      columns: ['Account', 'Date', 'Reference', 'Vendor', 'Description', 'Amount'],
      rows: [['Utility-Building Water', '01/15/2026', 'AP 5567', '', '1310 4/20/2026 Monthly water CITY WATER DEPT', '2100']]
    }
  }
  return enrichNarrative(narrative, { supporting: [gl] })
}

test('detailEvidence is attached as metadata on GL support entries', () => {
  const enriched = buildEnriched()
  const note = enriched.periods[0].highVariances.find((n) => n.account === 'Utility-Building Water')
  const gl = note.support.find((s) => /general\s*ledger|\bgl\b/i.test(s.classificationType))
  assert.ok(gl.detailEvidence, 'expected detailEvidence metadata on the GL support entry')
  assert.ok('vendorRenderable' in gl.detailEvidence && 'evidenceConfidence' in gl.detailEvidence)
})

test('owner narrative Markdown is identical with vs without the detailEvidence metadata', () => {
  const enriched = buildEnriched()
  const withMeta = narrativeToMarkdown(enriched)

  // Strip every `detailEvidence` field from the support entries and re-render.
  const stripped = {
    ...enriched,
    periods: enriched.periods.map((p) => ({
      ...p,
      highVariances: (p.highVariances || []).map((n) =>
        Array.isArray(n.support)
          ? { ...n, support: n.support.map(({ detailEvidence, ...rest }) => rest) } // eslint-disable-line no-unused-vars
          : n
      )
    }))
  }
  const withoutMeta = narrativeToMarkdown(stripped)
  assert.equal(withMeta, withoutMeta)
})
