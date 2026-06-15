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
import { enrichNarrative } from '../src/lib/enrich/index.js'
import { classifyGLCommentary } from '../src/lib/enrich/classify.js'

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

// --- Phase 19A: classified GL commentary — distribution & release targets ---
// A synthetic, non-sensitive GL corpus that exercises every category, run
// through the real enrichment path, then classified and measured against the
// PM release targets (A ≥5, B ≥5, C ≥10, D ≥3, E ≥1, F ≤30%, G no increase,
// generic-line reduction ≥70%). Phase 18A baseline: every reliable-total GL
// note rendered the single generic line "GL detail shows approximately $X of
// related activity" → 100% generic, 0 specific.

// One self-consistent triggered comparison record (variance-engine shape).
function qaRec({ account, actual, budget }) {
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
    category: varianceAmount >= 0 ? 'unfavorable' : 'favorable',
    accountType: 'expense',
    missingData: false,
    confidence: 90,
    sourceRows: [0]
  }
}

// Build a corpus account spec: a unique GL account name, a budget, an actual
// derived from the GL amounts, and the literal GL transaction amounts.
function spec(prefix, i, { budget, amounts }) {
  const name = `${prefix} Account ${String(i).padStart(2, '0')}`
  const glTotal = amounts.reduce((s, a) => s + a, 0)
  // Actual is set so each line is comfortably flagged; the exact value does not
  // affect classification (which reads the GL detail + the budget basis).
  const actual = budget + (glTotal >= 0 ? Math.max(glTotal, 1000) : glTotal)
  return { name, budget, actual, amounts }
}

function buildCorpus() {
  const specs = []
  // A — one-time (6)
  for (let i = 0; i < 6; i++) specs.push(spec('Alpha', i, { budget: 3000, amounts: [5000] }))
  // B — one-time-dominated (6): max 18000 / total 20000 = 0.90
  for (let i = 0; i < 6; i++) specs.push(spec('Bravo', i, { budget: 8000, amounts: [18000, 1000, 1000] }))
  // C — recurring (10): 4 even transactions, ratio 0.25
  for (let i = 0; i < 10; i++) specs.push(spec('Charlie', i, { budget: 2000, amounts: [1000, 1000, 1000, 1000] }))
  // D — unbudgeted (3): zero budget
  for (let i = 0; i < 3; i++) specs.push(spec('Delta', i, { budget: 0, amounts: [5000] }))
  // E — credit / true-up (2): negative total
  for (let i = 0; i < 2; i++) specs.push(spec('Echo', i, { budget: 4000, amounts: [-3000] }))
  // F — quantified fallback (1): count 3, ratio 0.70 (the 0.60–0.80 gap)
  specs.push(spec('Foxtrot', 0, { budget: 500, amounts: [700, 200, 100] }))

  const comparisons = specs.map((s) => qaRec({ account: s.name, actual: s.actual, budget: s.budget }))
  const narrative = generateNarrative({
    fileId: 'base',
    fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{ period: 'current', comparisons }]
  })

  const glRows = specs.flatMap((s) => s.amounts.map((a) => [s.name, String(a)]))
  const gl = {
    fileName: 'General Ledger.pdf',
    status: 'ok',
    classification: { type: 'General Ledger (GL)' },
    normalized: { columns: ['Account', 'Amount'], rows: glRows }
  }
  return { specs, enriched: enrichNarrative(narrative, { supporting: [gl] }) }
}

// Every GL-enriched high-variance note, with its classified category.
function classifiedNotes(enriched) {
  return enriched.periods[0].highVariances
    .filter((n) => Array.isArray(n.support) && n.support.some((s) => /general\s*ledger|\bgl\b/i.test(s.classificationType)))
    .map((n) => {
      const gl = n.support.find((s) => /general\s*ledger|\bgl\b/i.test(s.classificationType))
      const { type } = classifyGLCommentary({
        detail: gl.detail,
        comparison: n.comparison,
        comparisonType: n.comparisonType,
        confidence: gl.confidence,
        thick: gl.thick
      })
      return { note: n, type, detail: gl.detail }
    })
}

test('GL commentary distribution meets the Phase 19A release targets', () => {
  const { enriched } = buildCorpus()
  const notes = classifiedNotes(enriched)
  const dist = notes.reduce((m, x) => ((m[x.type] = (m[x.type] || 0) + 1), m), {})

  assert.ok((dist.A || 0) >= 5, `A ≥ 5, got ${dist.A || 0}`)
  assert.ok((dist.B || 0) >= 5, `B ≥ 5, got ${dist.B || 0}`)
  assert.ok((dist.C || 0) >= 10, `C ≥ 10, got ${dist.C || 0}`)
  assert.ok((dist.D || 0) >= 3, `D ≥ 3, got ${dist.D || 0}`)
  assert.ok((dist.E || 0) >= 1, `E ≥ 1, got ${dist.E || 0}`)

  const fShare = (dist.F || 0) / notes.length
  assert.ok(fShare <= 0.30, `F share ≤ 30%, got ${(fShare * 100).toFixed(1)}%`)

  // G must not increase over the Phase 18A baseline (0 for this corpus — no thin
  // or low-confidence matches are present).
  assert.equal(dist.G || 0, 0, 'G must not increase over baseline')
})

test('generic-line usage is reduced ≥70% vs the Phase 18A baseline', () => {
  const { enriched } = buildCorpus()
  const notes = classifiedNotes(enriched)

  // Baseline: in Phase 18A every reliable-total GL note rendered the generic line.
  const reliable = notes.filter((x) => typeof x.detail.total === 'number' && Number.isFinite(x.detail.total) && x.detail.total !== 0)
  const baselineGeneric = reliable.length
  assert.ok(baselineGeneric > 0, 'corpus must contain reliable-total GL notes')

  // After: count notes still rendering the old generic phrasing.
  const GENERIC = /GL detail shows approximately \$[\d,]+ of related (?:\w+ )?activity/
  const afterGeneric = notes.filter((x) => GENERIC.test(x.note.text)).length

  const reduction = (baselineGeneric - afterGeneric) / baselineGeneric
  assert.ok(reduction >= 0.70, `generic reduction ≥ 70%, got ${(reduction * 100).toFixed(1)}% (after=${afterGeneric}/${baselineGeneric})`)
})

test('no classified GL commentary leaks a vendor, file name, date, or causal phrase', () => {
  const { enriched } = buildCorpus()
  const md = narrativeToMarkdown(enriched)
  assert.doesNotMatch(md, /General Ledger\.pdf|Supporting file/)
  assert.doesNotMatch(md, /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/) // no dates
  assert.doesNotMatch(md, /due to|driven by|caused by|because of|explains|resulting from/i)
})
