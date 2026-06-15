// Export tests — Phase 10A (Copy + Markdown).
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
// Covers the deterministic export layer: Markdown generation from a real
// narrative shape, export availability gating, the copy payload, empty-narrative
// handling, and Current/YTD section formatting.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { generateNarrative } from '../src/lib/narrative/index.js'
import {
  narrativeToMarkdown,
  narrativeToClipboardText
} from '../src/lib/export/markdown.js'
import { canExport, exportFileName, hasNarrative } from '../src/lib/export/exportState.js'

// --- helpers ---------------------------------------------------------------

// One comparison record matching calculate.js output, with self-consistent
// variance math so the narrative engine produces real sentences.
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

// A single-period narrative with revenue (favorable), expense (unfavorable),
// and a missing-data line — exercising every section.
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

// A two-period narrative for Current / YTD coverage.
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

// --- markdown generation ---------------------------------------------------

test('markdown includes the title, metadata, and every section heading', () => {
  const md = narrativeToMarkdown(sampleNarrative())
  assert.match(md, /^# Variance Narrative$/m)
  assert.match(md, /- \*\*Source File:\*\* June Statement\.pdf/)
  assert.match(md, /- \*\*Classification:\*\* Base Variance Report/)
  assert.match(md, /- \*\*Thresholds:\*\* \$1,000 or 10%/)
  for (const title of ['Executive Summary', 'High Variances', 'Missing Data', 'Revenue Notes', 'Expense Notes']) {
    assert.ok(md.includes(`### ${title}`), `missing section: ${title}`)
  }
})

test('markdown carries the engine sentences verbatim and invents nothing', () => {
  const narrative = sampleNarrative()
  const md = narrativeToMarkdown(narrative)
  const period = narrative.periods[0]
  // Every note the engine produced appears as a bullet in the document.
  const allNotes = [
    ...period.executiveSummary,
    ...period.highVariances,
    ...period.missingData,
    ...period.revenueNotes,
    ...period.expenseNotes
  ]
  for (const note of allNotes) {
    assert.ok(md.includes(`- ${note.text}`), `missing note: ${note.text}`)
  }
})

test('markdown export is owner-readable — never raw JSON or source-row indices', () => {
  const md = narrativeToMarkdown(sampleNarrative())
  assert.ok(!md.includes('{'), 'markdown leaked a JSON brace')
  assert.ok(!md.includes('sourceRows'), 'markdown leaked source-row internals')
  assert.ok(!md.includes('"text"'), 'markdown leaked a serialized note object')
})

test('markdown generation is deterministic — identical input, identical output', () => {
  const a = narrativeToMarkdown(sampleNarrative())
  const b = narrativeToMarkdown(sampleNarrative())
  assert.equal(a, b)
  // Stable section ordering regardless of how the data was assembled.
  const order = ['Executive Summary', 'High Variances', 'Missing Data', 'Revenue Notes', 'Expense Notes']
  const positions = order.map((t) => a.indexOf(`### ${t}`))
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i] > positions[i - 1], `section out of order at ${order[i]}`)
  }
})

// --- empty narrative handling ----------------------------------------------

test('empty narrative still produces a valid, honest document', () => {
  const md = narrativeToMarkdown(generateNarrative(varianceResult([])))
  assert.match(md, /^# Variance Narrative$/m)
  assert.match(md, /nothing to narrate/)
  assert.ok(!md.includes('### '), 'empty narrative should emit no sections')
})

test('a section with no triggered rows renders an explicit None', () => {
  // Only a revenue line triggers, so Expense Notes is empty.
  const narrative = generateNarrative(
    varianceResult([
      { period: 'current', comparisons: [
        rec({ account: 'Rental Income', actual: 12000, budget: 10000, accountType: 'revenue', category: 'favorable', sourceRows: [3] })
      ] }
    ])
  )
  const md = narrativeToMarkdown(narrative)
  assert.ok(md.includes('### Expense Notes'))
  // The Expense Notes block exists but says None rather than fabricating a line.
  const expenseBlock = md.slice(md.indexOf('### Expense Notes'))
  assert.match(expenseBlock, /_None\._/)
})

test('narrativeToMarkdown tolerates null/garbage input without throwing', () => {
  assert.doesNotThrow(() => narrativeToMarkdown(null))
  assert.doesNotThrow(() => narrativeToMarkdown(undefined))
  assert.doesNotThrow(() => narrativeToMarkdown({}))
  assert.match(narrativeToMarkdown(null), /nothing to narrate/)
})

// --- Current / YTD formatting ----------------------------------------------

test('multi-period narrative renders Current then YTD as ordered sections', () => {
  const md = narrativeToMarkdown(multiPeriodNarrative())
  const current = md.indexOf('## Current')
  const ytd = md.indexOf('## YTD')
  assert.ok(current >= 0, 'missing Current period heading')
  assert.ok(ytd >= 0, 'missing YTD period heading')
  assert.ok(current < ytd, 'Current must precede YTD')
  // Each period carries its own full set of section headings.
  assert.equal((md.match(/### Executive Summary/g) || []).length, 2)
})

// --- copy flow -------------------------------------------------------------

test('clipboard text is byte-identical to the markdown download', () => {
  const narrative = sampleNarrative()
  assert.equal(narrativeToClipboardText(narrative), narrativeToMarkdown(narrative))
})

// --- export availability ---------------------------------------------------

test('canExport is true only after a successful generation with a narrative', () => {
  const narrative = sampleNarrative()
  assert.equal(canExport({ status: 'success', narrative }), true)
  // An empty-but-present narrative is still exportable (states nothing to narrate).
  assert.equal(canExport({ status: 'success', narrative: generateNarrative(varianceResult([])) }), true)
})

test('canExport is false before generation, while busy, on failure, or with no narrative', () => {
  const narrative = sampleNarrative()
  assert.equal(canExport({ status: 'idle', narrative }), false)
  assert.equal(canExport({ status: 'preparing', narrative }), false)
  assert.equal(canExport({ status: 'sending', narrative }), false)
  assert.equal(canExport({ status: 'failure', narrative }), false)
  assert.equal(canExport({ status: 'success', narrative: null }), false)
  assert.equal(canExport({ status: 'success', narrative: {} }), false)
  assert.equal(canExport({}), false)
})

test('hasNarrative recognizes a narrative object by its periods array', () => {
  assert.equal(hasNarrative({ periods: [] }), true)
  assert.equal(hasNarrative({ periods: [{ period: 'current' }] }), true)
  assert.equal(hasNarrative({}), false)
  assert.equal(hasNarrative(null), false)
})

test('exportFileName slugs the source filename deterministically and ends in .md', () => {
  assert.equal(exportFileName({ fileName: 'June Statement.pdf' }), 'june-statement-variance-narrative.md')
  assert.equal(exportFileName({ fileName: 'Q2 2026 — Building #4.xlsx' }), 'q2-2026-building-4-variance-narrative.md')
  assert.equal(exportFileName({}), 'variance-narrative.md')
  assert.equal(exportFileName(null), 'variance-narrative.md')
})
