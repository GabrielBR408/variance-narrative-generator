// Excel export tests — Phase 17.
// Runs on Node's built-in test runner (`node --test`).
//
// Covers the deterministic Excel export: the pure owner/evidence row models are
// correct, the owner sheet never leaks a supporting-file name, the Actual /
// Budget-Prior columns are populated from the new note metadata, GL detail flows
// into the Supporting Detail column, the workbook re-reads with bold headers /
// frozen top row / currency + percent number formats intact, and the export
// respects Period Scope and base-only/empty narratives.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'

import { generateNarrative } from '../src/lib/narrative/index.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'
import { scopeNarrative } from '../src/lib/narrative/periodScope.js'
import {
  buildExcelModel,
  buildOwnerRows,
  narrativeToExcelBuffer,
  OWNER_SHEET,
  EVIDENCE_SHEET,
  OWNER_COLUMNS
} from '../src/lib/export/excel.js'

// --- helpers (shared shape with the enrich tests) --------------------------

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

function baseNarrative(comparisons, period = 'current') {
  return generateNarrative({
    fileId: 'base',
    fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{ period, comparisons }]
  })
}

function supporting({ fileName, type, columns, rows }) {
  return { fileName, status: 'ok', classification: { type }, normalized: { columns, rows } }
}

const GL = (fileName = 'General Ledger.pdf') =>
  supporting({
    fileName,
    type: 'General Ledger (GL)',
    columns: ['Account', 'Vendor', 'Amount'],
    rows: [
      ['Utility Expense Recovery', 'PG&E', '4000'],
      ['Utility Expense Recovery', 'PG&E', '3400']
    ]
  })

const FLAGGED = [
  rec({ account: 'Utility Expense Recovery', actual: 12700, budget: 5334, accountType: 'expense', category: 'unfavorable', sourceRows: [4] })
]

const FIXED_DATE = new Date('2026-06-15T00:00:00Z')

// --- pure model ------------------------------------------------------------

test('owner columns are exactly the spec set, in order', () => {
  assert.deepEqual(
    OWNER_COLUMNS.map((c) => c.header),
    ['Section', 'Period', 'Account', 'Actual', 'Budget / Prior', 'Variance $', 'Variance %', 'Category', 'Narrative / Explanation', 'Supporting Detail']
  )
})

test('owner rows carry Actual and Budget/Prior from the note metadata', () => {
  const rows = buildOwnerRows(baseNarrative(FLAGGED))
  const row = rows.find((r) => r.account === 'Utility Expense Recovery')
  assert.equal(row.actual, 12700)
  assert.equal(row.comparison, 5334)
  assert.equal(row.varianceAmount, 7366)
  assert.ok(Math.abs(row.variancePercent - 138.1) < 0.1)
  assert.equal(row.category, 'Unfavorable')
  assert.equal(row.section, 'High Variance')
})

test('owner Supporting Detail summarizes GL detail without any file name', () => {
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [GL('4. General Ledger.pdf')] })
  const rows = buildOwnerRows(enriched)
  const row = rows.find((r) => r.account === 'Utility Expense Recovery')
  assert.match(row.supporting, /^GL:/)
  assert.match(row.supporting, /PG&E/)
  assert.match(row.supporting, /~\$7,400/)
  assert.doesNotMatch(row.supporting, /General Ledger\.pdf|Supporting file/)
})

test('meta block includes source file, classification, thresholds and generated date', () => {
  const model = buildExcelModel(baseNarrative(FLAGGED), { generatedDate: FIXED_DATE })
  const byLabel = Object.fromEntries(model.meta.map((m) => [m.label, m.value]))
  assert.equal(byLabel['Source File'], 'Comparative Income Statement.xlsx')
  assert.equal(byLabel['Classification'], 'Base Variance Report')
  assert.equal(byLabel['Generated'], '2026-06-15')
  assert.match(byLabel['Thresholds'], /\$1,000.* or 10%/)
})

test('evidence rows carry the file name (debug sheet) and GL totals', () => {
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [GL('General Ledger.pdf')] })
  const model = buildExcelModel(enriched, { generatedDate: FIXED_DATE })
  assert.equal(model.evidenceRows.length, 1)
  const ev = model.evidenceRows[0]
  assert.equal(ev.fileName, 'General Ledger.pdf')
  assert.equal(ev.matches, 2)
  assert.equal(ev.total, 7400)
  assert.equal(ev.vendor, 'PG&E')
})

// --- workbook round-trip ---------------------------------------------------

test('workbook re-reads with bold frozen header, currency + percent formats', async () => {
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [GL()] })
  const buf = await narrativeToExcelBuffer(enriched, { generatedDate: FIXED_DATE })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)

  const owner = wb.getWorksheet(OWNER_SHEET)
  assert.ok(owner, 'owner sheet exists')
  // Frozen top region (header row pinned).
  assert.equal(owner.views[0].state, 'frozen')
  assert.ok(owner.views[0].ySplit >= 1)
  // Currency + percent number formats survive on the data columns.
  assert.equal(owner.getColumn(4).numFmt, '$#,##0.00') // Actual
  assert.equal(owner.getColumn(7).numFmt, '0.0%') // Variance %
  // The header row is bold somewhere in the frozen region.
  const headerRow = owner.getRow(owner.views[0].ySplit)
  assert.ok(headerRow.getCell(1).font && headerRow.getCell(1).font.bold, 'header is bold')

  // Second sheet carries the evidence metadata.
  assert.ok(wb.getWorksheet(EVIDENCE_SHEET), 'evidence sheet exists')
})

test('Variance % is stored as a fraction so 0.0% renders the right number', async () => {
  const buf = await narrativeToExcelBuffer(enrichNarrative(baseNarrative(FLAGGED), { supporting: [GL()] }), {
    generatedDate: FIXED_DATE
  })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const owner = wb.getWorksheet(OWNER_SHEET)
  // Find the data row for the account and read the Variance % cell (col 7).
  let pct = null
  owner.eachRow((row) => {
    if (row.getCell(3).value === 'Utility Expense Recovery') pct = row.getCell(7).value
  })
  assert.ok(pct !== null && Math.abs(pct - 1.381) < 0.01, `expected ~1.381, got ${pct}`)
})

// --- no supporting-file name anywhere on the owner sheet -------------------

test('owner sheet never contains a supporting-file name', async () => {
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [GL('4. General Ledger.pdf')] })
  const buf = await narrativeToExcelBuffer(enriched, { generatedDate: FIXED_DATE })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const owner = wb.getWorksheet(OWNER_SHEET)
  let text = ''
  owner.eachRow((row) => row.eachCell((cell) => (text += ` ${cell.value}`)))
  assert.doesNotMatch(text, /General Ledger\.pdf/)
  assert.doesNotMatch(text, /Supporting file/)
})

// --- Period Scope interop --------------------------------------------------

test('Excel respects the selected period scope', () => {
  const two = generateNarrative({
    fileId: 'base',
    fileName: 'X.xlsx',
    baseClassification: 'Base',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [
      { period: 'current', comparisons: FLAGGED },
      { period: 'ytd', comparisons: FLAGGED }
    ]
  })
  const enriched = enrichNarrative(two, { supporting: [GL()] })
  const current = scopeNarrative(enriched, 'current')
  const periods = new Set(buildOwnerRows(current).map((r) => r.period))
  assert.deepEqual([...periods], ['Current'])
})

// --- base-only / empty narratives still export cleanly ---------------------

test('base-only narrative exports with no evidence sheet and no supporting detail', async () => {
  const model = buildExcelModel(baseNarrative(FLAGGED), { generatedDate: FIXED_DATE })
  assert.equal(model.evidenceRows.length, 0)
  assert.ok(model.ownerRows.every((r) => r.supporting === ''))
  const buf = await narrativeToExcelBuffer(baseNarrative(FLAGGED), { generatedDate: FIXED_DATE })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  assert.ok(wb.getWorksheet(OWNER_SHEET))
  assert.equal(wb.getWorksheet(EVIDENCE_SHEET), undefined, 'no evidence sheet when nothing is enriched')
})

test('an empty narrative still produces a valid workbook', async () => {
  const empty = generateNarrative({ fileName: 'empty.xlsx', baseClassification: 'Base', comparisonSets: [] })
  const buf = await narrativeToExcelBuffer(empty, { generatedDate: FIXED_DATE })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  assert.ok(wb.getWorksheet(OWNER_SHEET), 'owner sheet exists even with no periods')
})
