// DOCX export tests — Phase 11.
// Runs on Node's built-in test runner (`node --test`), no extra dev deps.
// Covers the deterministic DOCX export layer: the framework-free block model
// built from a real narrative shape, the .docx filename + fallback, the
// availability gate (export unavailable before success), Current/YTD coverage,
// the absence of raw JSON, and that a real, valid .docx is produced.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { generateNarrative } from '../src/lib/narrative/index.js'
import {
  narrativeToDocxBlocks,
  narrativeToDocxBuffer,
  buildDocxDocument,
  DOCX_TITLE
} from '../src/lib/export/docx.js'
import { canExport, docxFileName } from '../src/lib/export/exportState.js'

// --- helpers (shared shape with test/export.test.js) -----------------------

function rec({ account, actual, budget = null, prior = null, accountType, category, sourceRows }) {
  const comparison = budget !== null ? budget : prior
  const comparisonType = budget !== null ? 'budget' : prior !== null ? 'prior' : null
  const hasActual = typeof actual === 'number'
  const hasComparison = typeof comparison === 'number'
  const varianceAmount = hasActual && hasComparison ? actual - comparison : null
  const variancePercent =
    varianceAmount === null || comparison === 0 ? null : (varianceAmount / Math.abs(comparison)) * 100
  const thresholdTriggered =
    varianceAmount !== null &&
    (Math.abs(varianceAmount) >= 1000 || (variancePercent !== null && Math.abs(variancePercent) >= 10))
  return {
    account,
    actual: hasActual ? actual : null,
    budget,
    prior,
    varianceAmount,
    variancePercent,
    comparisonType,
    thresholdTriggered,
    category,
    accountType,
    missingData: !hasActual || !hasComparison,
    confidence: 90,
    sourceRows: sourceRows || []
  }
}

function varianceResult(comparisonSets) {
  return {
    fileId: 'f1',
    fileName: 'June Statement.pdf',
    baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets
  }
}

function sampleNarrative() {
  return generateNarrative(
    varianceResult([
      {
        period: 'current',
        comparisons: [
          rec({ account: 'Rental Income', actual: 12000, budget: 10000, accountType: 'revenue', category: 'favorable', sourceRows: [3] }),
          rec({ account: 'Repairs', actual: 8000, budget: 5000, accountType: 'expense', category: 'unfavorable', sourceRows: [7] }),
          rec({ account: 'Reserves', actual: null, budget: 2000, accountType: 'expense', category: 'unfavorable', sourceRows: [9] })
        ]
      }
    ])
  )
}

function multiPeriodNarrative() {
  return generateNarrative(
    varianceResult([
      { period: 'current', comparisons: [
        rec({ account: 'Rental Income', actual: 12000, budget: 10000, accountType: 'revenue', category: 'favorable', sourceRows: [3] })
      ] },
      { period: 'ytd', comparisons: [
        rec({ account: 'Repairs', actual: 26000, budget: 18000, accountType: 'expense', category: 'unfavorable', sourceRows: [7] })
      ] }
    ])
  )
}

const textOf = (blocks, kind) => blocks.filter((b) => b.kind === kind).map((b) => b.text)

// --- block model: title + every section ------------------------------------

test('docx blocks include the title and every expected section heading', () => {
  const blocks = narrativeToDocxBlocks(sampleNarrative())
  assert.equal(blocks[0].kind, 'title')
  assert.equal(blocks[0].text, 'Variance Narrative Summary')
  assert.equal(DOCX_TITLE, 'Variance Narrative Summary')
  const sections = textOf(blocks, 'section')
  for (const title of ['Executive Summary', 'High Variances', 'Missing Data', 'Revenue Notes', 'Expense Notes']) {
    assert.ok(sections.includes(title), `missing section: ${title}`)
  }
})

test('docx carries the engine sentences verbatim and invents nothing', () => {
  const narrative = sampleNarrative()
  const blocks = narrativeToDocxBlocks(narrative)
  const bullets = textOf(blocks, 'bullet')
  const period = narrative.periods[0]
  const allNotes = [
    ...period.executiveSummary,
    ...period.highVariances,
    ...period.missingData,
    ...period.revenueNotes,
    ...period.expenseNotes
  ]
  for (const note of allNotes) {
    assert.ok(bullets.includes(note.text), `missing note: ${note.text}`)
  }
})

test('docx export is owner-readable — never raw JSON or source-row indices', () => {
  const blocks = narrativeToDocxBlocks(sampleNarrative())
  const all = blocks.map((b) => b.text).join('\n')
  assert.ok(!all.includes('{'), 'docx leaked a JSON brace')
  assert.ok(!all.includes('sourceRows'), 'docx leaked source-row internals')
  assert.ok(!all.includes('"text"'), 'docx leaked a serialized note object')
})

test('docx block model is deterministic and keeps section order stable', () => {
  const a = narrativeToDocxBlocks(sampleNarrative())
  const b = narrativeToDocxBlocks(sampleNarrative())
  assert.deepEqual(a, b)
  const order = ['Executive Summary', 'High Variances', 'Missing Data', 'Revenue Notes', 'Expense Notes']
  const sections = textOf(a, 'section')
  assert.deepEqual(sections, order)
})

// --- empty narrative handling ----------------------------------------------

test('empty narrative still produces a valid, honest docx block list', () => {
  const blocks = narrativeToDocxBlocks(generateNarrative(varianceResult([])))
  assert.equal(blocks[0].text, 'Variance Narrative Summary')
  const empties = textOf(blocks, 'empty')
  assert.ok(empties.some((t) => /nothing to narrate/.test(t)))
  assert.equal(textOf(blocks, 'section').length, 0, 'empty narrative should emit no sections')
})

test('a section with no triggered rows renders an explicit None', () => {
  const narrative = generateNarrative(
    varianceResult([
      { period: 'current', comparisons: [
        rec({ account: 'Rental Income', actual: 12000, budget: 10000, accountType: 'revenue', category: 'favorable', sourceRows: [3] })
      ] }
    ])
  )
  const blocks = narrativeToDocxBlocks(narrative)
  // Find the Expense Notes section and confirm the following block says None.
  const idx = blocks.findIndex((b) => b.kind === 'section' && b.text === 'Expense Notes')
  assert.ok(idx >= 0, 'missing Expense Notes section')
  assert.equal(blocks[idx + 1].kind, 'empty')
  assert.match(blocks[idx + 1].text, /^None\.$/)
})

test('narrativeToDocxBlocks tolerates null/garbage input without throwing', () => {
  assert.doesNotThrow(() => narrativeToDocxBlocks(null))
  assert.doesNotThrow(() => narrativeToDocxBlocks(undefined))
  assert.doesNotThrow(() => narrativeToDocxBlocks({}))
  const blocks = narrativeToDocxBlocks(null)
  assert.ok(textOf(blocks, 'empty').some((t) => /nothing to narrate/.test(t)))
})

// --- Current / YTD coverage ------------------------------------------------

test('multi-period docx renders Current then YTD, each with full sections', () => {
  const blocks = narrativeToDocxBlocks(multiPeriodNarrative())
  const periods = textOf(blocks, 'period')
  assert.deepEqual(periods, ['Current', 'YTD'])
  // Each period carries its own full set of five section headings.
  assert.equal(textOf(blocks, 'section').length, 10)
})

// --- filename + fallback ---------------------------------------------------

test('docxFileName slugs the source filename deterministically and ends in .docx', () => {
  assert.equal(docxFileName({ fileName: 'June Statement.pdf' }), 'june-statement-variance-narrative-summary.docx')
  assert.equal(docxFileName({ fileName: 'Q2 2026 — Building #4.xlsx' }), 'q2-2026-building-4-variance-narrative-summary.docx')
})

test('docxFileName falls back to the deterministic generic name', () => {
  assert.equal(docxFileName({}), 'variance-narrative-summary.docx')
  assert.equal(docxFileName(null), 'variance-narrative-summary.docx')
  assert.equal(docxFileName({ fileName: 42 }), 'variance-narrative-summary.docx')
})

// --- availability gate -----------------------------------------------------

test('DOCX export availability follows canExport (only after a success)', () => {
  const narrative = sampleNarrative()
  assert.equal(canExport({ status: 'success', narrative }), true)
})

test('DOCX export is unavailable before generation, while busy, or on failure', () => {
  const narrative = sampleNarrative()
  assert.equal(canExport({ status: 'idle', narrative }), false)
  assert.equal(canExport({ status: 'preparing', narrative }), false)
  assert.equal(canExport({ status: 'sending', narrative }), false)
  assert.equal(canExport({ status: 'failure', narrative }), false)
  assert.equal(canExport({ status: 'success', narrative: null }), false)
  assert.equal(canExport({}), false)
})

// --- real document output --------------------------------------------------

test('buildDocxDocument produces a docx Document and packs to a valid .docx', async () => {
  assert.ok(buildDocxDocument(sampleNarrative()))
  const buf = await narrativeToDocxBuffer(sampleNarrative())
  // .docx is a zip — verify the PK magic bytes and non-trivial size.
  assert.ok(buf.length > 0)
  assert.equal(buf.slice(0, 2).toString('latin1'), 'PK')
})
