// Real-report QA + Markdown/DOCX parity — Phase 14.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Drives a realistic (non-sensitive, fully synthetic) Comparative Income
// Statement through the full deterministic pipeline —
//   normalize → computeVariance → generateNarrative → Markdown + DOCX —
// and asserts the Phase 14 quality goals end-to-end:
//   • leading report metadata is skipped, Current and YTD stay separated,
//   • every dollar/percent figure survives into BOTH exports,
//   • the Markdown and DOCX exports carry exactly the same note bullets
//     (structural parity — the two documents can never describe different lines),
//   • the executive summary is a single sentence per period,
//   • neither export leaks JSON or source-row internals.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalize } from '../src/lib/extract/normalize.js'
import { computeVariance } from '../src/lib/variance/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'
import { narrativeToDocxBlocks } from '../src/lib/export/docx.js'

// A faithful real-report shape with zero sensitive data: leading metadata rows,
// a merged Current Period / Year-To-Date group band, repeated Actual/Budget/
// Variance sub-headers, then accounts (one of which is missing its actual).
const GRID = [
  ['Database: DEMO', 'Comparative Income Statement', '', '', '', 'Page:', ''],
  ['Property: Example Plaza', '', '', '', '', 'Date:', ''],
  ['Accrual', '', '', '', '', '', ''],
  ['', 'Current Period', '', '', 'Year-To-Date', '', ''],
  ['Account', 'Actual', 'Budget', 'Variance', 'Actual', 'Budget', 'Variance'],
  ['Rental Income', '130000', '100000', '30000', '700000', '600000', '100000'],
  ['Repairs Expense', '60000', '40000', '20000', '300000', '250000', '50000'],
  ['Reserves', '', '20000', '', '', '120000', '']
]

function spreadsheet(grid) {
  return { text: [], tables: [{ name: 'Sheet1', rows: grid, columnCount: grid[0].length }], metadata: {} }
}

function buildNarrative() {
  const { normalized, confidence } = normalize(spreadsheet(GRID), 'spreadsheet')
  const variance = computeVariance({
    fileId: 'f1',
    fileName: 'Comparative Income Statement.xlsx',
    status: 'ok',
    confidence,
    classification: { type: 'variance-report' },
    normalized
  })
  return { variance, narrative: generateNarrative(variance) }
}

// Note bullets the Markdown export emits, grouped out of the per-period sections
// (the leading metadata bullets live above the first `## ` heading and so are
// excluded). Order is preserved.
function markdownBullets(md) {
  return md
    .split(/^## /m)
    .slice(1)
    .flatMap((chunk) =>
      chunk
        .split('\n')
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2))
    )
}

// Note bullets the DOCX block model emits, in order.
function docxBullets(blocks) {
  return blocks.filter((b) => b.kind === 'bullet').map((b) => b.text)
}

// --- pipeline produces both periods with real figures ----------------------

test('real report: metadata skipped, Current and YTD both narrated with figures', () => {
  const { variance, narrative } = buildNarrative()
  assert.equal(variance.reason, undefined)
  assert.deepEqual(narrative.periods.map((p) => p.period), ['current', 'ytd'])

  const md = narrativeToMarkdown(narrative)
  // Current precedes YTD and each carries its own headed section block.
  const cur = md.indexOf('## Current')
  const ytd = md.indexOf('## YTD')
  assert.ok(cur >= 0 && ytd >= 0 && cur < ytd, 'Current must precede YTD')

  // Real figures survive into the document for both periods.
  assert.ok(md.includes('$30,000'), 'current rental variance missing from Markdown')
  assert.ok(md.includes('$100,000'), 'YTD rental variance missing from Markdown')
})

// --- Markdown / DOCX structural parity -------------------------------------

test('Markdown and DOCX carry exactly the same note bullets, in the same order', () => {
  const { narrative } = buildNarrative()
  const md = markdownBullets(narrativeToMarkdown(narrative))
  const dx = docxBullets(narrativeToDocxBlocks(narrative))
  assert.ok(md.length > 0, 'expected at least one note bullet')
  assert.deepEqual(md, dx)
})

test('both exports keep every dollar figure intact (no figure dropped in either)', () => {
  const { narrative } = buildNarrative()
  const md = narrativeToMarkdown(narrative)
  const dx = narrativeToDocxBlocks(narrative).map((b) => b.text).join('\n')
  for (const figure of ['$30,000', '$20,000', '$100,000', '$50,000']) {
    assert.ok(md.includes(figure), `Markdown missing ${figure}`)
    assert.ok(dx.includes(figure), `DOCX missing ${figure}`)
  }
})

// --- executive summary tightness + no leakage ------------------------------

test('each period has a single-sentence executive summary', () => {
  const { narrative } = buildNarrative()
  for (const period of narrative.periods) {
    assert.equal(period.executiveSummary.length, 1)
    assert.doesNotMatch(period.executiveSummary[0].text, /Of these/)
  }
})

test('neither export leaks JSON braces or source-row internals', () => {
  const { narrative } = buildNarrative()
  const md = narrativeToMarkdown(narrative)
  const dx = narrativeToDocxBlocks(narrative).map((b) => b.text).join('\n')
  for (const blob of [md, dx]) {
    assert.ok(!blob.includes('{'), 'leaked a JSON brace')
    assert.ok(!blob.includes('sourceRows'), 'leaked source-row internals')
  }
})

// --- owner-priority grouping carries through to the document ---------------

test('High Variances leads with the unfavorable expense before the favorable revenue', () => {
  const { narrative } = buildNarrative()
  const current = narrative.periods[0]
  const accounts = current.highVariances.map((n) => n.account)
  assert.deepEqual(accounts, ['Repairs Expense', 'Rental Income'])
})
