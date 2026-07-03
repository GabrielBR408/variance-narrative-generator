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
  buildEvidenceRows,
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

// Amounts carry cents and do not sum to a round figure, so the rounded
// "approximately" display can be distinguished from the raw internal total
// (9200.50 + 8215.49 = 17415.99 → displays as ~$17,400).
const GL = (fileName = 'General Ledger.pdf') =>
  supporting({
    fileName,
    type: 'General Ledger (GL)',
    columns: ['Account', 'Vendor', 'Amount'],
    rows: [
      ['Utility Expense Recovery', 'PG&E', '9200.50'],
      ['Utility Expense Recovery', 'PG&E', '8215.49']
    ]
  })

const FLAGGED = [
  rec({ account: 'Utility Expense Recovery', actual: 12700, budget: 5334, accountType: 'expense', category: 'unfavorable', sourceRows: [4] })
]

// LOCAL midnight, not UTC: the export stamps the user's local click-time date
// (a UTC read would date evening US exports tomorrow), so the fixture pins the
// local calendar date to stay timezone-independent.
const FIXED_DATE = new Date(2026, 5, 15)

// --- pure model ------------------------------------------------------------

test('owner columns are exactly the spec set, in order', () => {
  assert.deepEqual(
    OWNER_COLUMNS.map((c) => c.header),
    [
      'Account',
      'Current Actual',
      'Current Budget',
      'Current Variance',
      'Current Variance %',
      'YTD Actual',
      'YTD Budget',
      'YTD Variance',
      'YTD Variance %',
      'Current Category',
      'Current Status',
      'Current Explanation',
      'Current Supporting Detail',
      'YTD Category',
      'YTD Status',
      'YTD Explanation',
      'YTD Supporting Detail'
    ]
  )
})

test('owner rows carry Current Actual and Budget from the note metadata', () => {
  const rows = buildOwnerRows(baseNarrative(FLAGGED))
  const row = rows.find((r) => r.account === 'Utility Expense Recovery')
  assert.equal(row.currentActual, 12700)
  assert.equal(row.currentComparison, 5334)
  assert.equal(row.currentVarianceAmount, 7366)
  assert.ok(Math.abs(row.currentVariancePercent - 138.1) < 0.1)
  assert.equal(row.currentCategory, 'Unfavorable')
  assert.equal(row.currentSection, 'High Variance')
})

test('owner Supporting Detail summarizes GL detail without any file name', () => {
  const enriched = enrichNarrative(baseNarrative(FLAGGED), { supporting: [GL('4. General Ledger.pdf')] })
  const rows = buildOwnerRows(enriched)
  const row = rows.find((r) => r.account === 'Utility Expense Recovery')
  assert.match(row.currentSupporting, /^GL:/)
  assert.match(row.currentSupporting, /PG&E/)
  // Rounded "approximately" presentation matching the narrative — no cents.
  assert.match(row.currentSupporting, /~\$17,400\b/)
  assert.doesNotMatch(row.currentSupporting, /17,415\.99|\.\d\d/)
  assert.doesNotMatch(row.currentSupporting, /General Ledger\.pdf|Supporting file/)
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
  // The evidence sheet preserves the exact raw total (no rounding) for traceability.
  assert.ok(Math.abs(ev.total - 17415.99) < 0.001, `expected raw 17415.99, got ${ev.total}`)
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
  // Currency + percent number formats survive on the side-by-side data columns.
  assert.equal(owner.getColumn(2).numFmt, '$#,##0.00') // Current Actual
  assert.equal(owner.getColumn(5).numFmt, '0.0%') // Current Variance %
  assert.equal(owner.getColumn(6).numFmt, '$#,##0.00') // YTD Actual
  assert.equal(owner.getColumn(9).numFmt, '0.0%') // YTD Variance %
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
  // Find the data row for the account (col 1) and read the Current Variance %
  // cell (col 5).
  let pct = null
  owner.eachRow((row) => {
    if (row.getCell(1).value === 'Utility Expense Recovery') pct = row.getCell(5).value
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

test('Excel lays Current and YTD side by side and respects period scope', () => {
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

  // Both periods → ONE merged row per account, Current and YTD side by side.
  const rows = buildOwnerRows(enriched)
  const matches = rows.filter((r) => r.account === 'Utility Expense Recovery')
  assert.equal(matches.length, 1, 'a single comparative row carries both periods')
  assert.equal(matches[0].currentActual, 12700)
  assert.equal(matches[0].currentComparison, 5334)
  assert.equal(matches[0].ytdActual, 12700)
  assert.equal(matches[0].ytdComparison, 5334)

  // Scoped to Current: the Current columns are populated, the YTD side is blank.
  const current = scopeNarrative(enriched, 'current')
  const cRow = buildOwnerRows(current).find((r) => r.account === 'Utility Expense Recovery')
  assert.equal(cRow.currentActual, 12700)
  assert.equal(cRow.ytdActual, null)

  // Scoped to YTD: the YTD columns are populated, the Current side is blank.
  const ytd = scopeNarrative(enriched, 'ytd')
  const yRow = buildOwnerRows(ytd).find((r) => r.account === 'Utility Expense Recovery')
  assert.equal(yRow.ytdActual, 12700)
  assert.equal(yRow.currentActual, null)
})

// --- base-only / empty narratives still export cleanly ---------------------

test('base-only narrative exports with no evidence sheet and no supporting detail', async () => {
  const model = buildExcelModel(baseNarrative(FLAGGED), { generatedDate: FIXED_DATE })
  assert.equal(model.evidenceRows.length, 0)
  assert.ok(model.ownerRows.every((r) => r.currentSupporting === '' && r.ytdSupporting === ''))
  const buf = await narrativeToExcelBuffer(baseNarrative(FLAGGED), { generatedDate: FIXED_DATE })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  assert.ok(wb.getWorksheet(OWNER_SHEET))
  assert.equal(wb.getWorksheet(EVIDENCE_SHEET), undefined, 'no evidence sheet when nothing is enriched')
})

// --- all narrated sections reach the owner + evidence sheets ----------------
// The engine caps High Variances at 3 headline drivers and defers the remaining
// triggered rows to Revenue/Expense/Context Notes. The Excel export must read
// ALL of those sections: the deferred rows' Explanation/Supporting Detail and
// their GL evidence used to be silently dropped (blank cells + a wrong
// "High Variance" status), so the .xlsx disagreed with the DOCX/Markdown.

// Three big headline drivers, one deferred expense note, one deferred revenue
// note, and a deferred timing line that re-homes to Context Notes.
const SPREAD = [
  rec({ account: 'Exp Big', actual: 60000, budget: 10000, accountType: 'expense', category: 'unfavorable', sourceRows: [1] }),
  rec({ account: 'Exp Mid', actual: 50000, budget: 10000, accountType: 'expense', category: 'unfavorable', sourceRows: [2] }),
  rec({ account: 'Rev Big', actual: 40000, budget: 10000, accountType: 'revenue', category: 'favorable', sourceRows: [3] }),
  rec({ account: 'Exp Small', actual: 30000, budget: 10000, accountType: 'expense', category: 'unfavorable', sourceRows: [4] }),
  rec({ account: 'Rev Small', actual: 25000, budget: 10000, accountType: 'revenue', category: 'favorable', sourceRows: [5] }),
  rec({ account: 'Prepaid Insurance', actual: 18000, budget: 10000, accountType: 'expense', category: 'unfavorable', sourceRows: [6] })
]

test('deferred Revenue/Expense/Context notes carry their explanation and section status', () => {
  const narrative = baseNarrative(SPREAD)
  // Sanity: the fixture really defers rows out of the headline.
  const p = narrative.periods[0]
  assert.equal(p.highVariances.length, 3)
  assert.equal(p.revenueNotes.length, 1)
  assert.equal(p.expenseNotes.length, 1)
  assert.equal(p.contextNotes.length, 1)

  const rows = buildOwnerRows(narrative)
  const byAccount = Object.fromEntries(rows.map((r) => [r.account, r]))
  // Headline drivers keep the High Variance status.
  assert.equal(byAccount['Exp Big'].currentSection, 'High Variance')
  assert.match(byAccount['Exp Big'].currentNarrative, /Exp Big/)
  // Deferred notes name the section they actually live in — never a blank
  // Explanation under a false "High Variance" label.
  assert.equal(byAccount['Rev Small'].currentSection, 'Revenue Note')
  assert.match(byAccount['Rev Small'].currentNarrative, /Rev Small/)
  assert.equal(byAccount['Exp Small'].currentSection, 'Expense Note')
  assert.match(byAccount['Exp Small'].currentNarrative, /Exp Small/)
  assert.equal(byAccount['Prepaid Insurance'].currentSection, 'Context Note')
  assert.match(byAccount['Prepaid Insurance'].currentNarrative, /Prepaid Insurance/)
})

test('GL evidence on a deferred note reaches the Supporting Evidence sheet', () => {
  const gl = supporting({
    fileName: 'General Ledger.pdf',
    type: 'General Ledger (GL)',
    columns: ['Account', 'Vendor', 'Amount'],
    rows: [
      ['Exp Small', 'Acme Services', '10000'],
      ['Exp Small', 'Acme Services', '10000']
    ]
  })
  const enriched = enrichNarrative(baseNarrative(SPREAD), { supporting: [gl] })
  const evidence = buildEvidenceRows(enriched)
  const row = evidence.find((r) => r.account === 'Exp Small')
  assert.ok(row, 'evidence on an Expense Note row appears on the evidence sheet')
  assert.equal(row.fileName, 'General Ledger.pdf')
  // The owner row's Supporting Detail is populated too.
  const owner = buildOwnerRows(enriched).find((r) => r.account === 'Exp Small')
  assert.match(owner.currentSupporting, /^GL:/)
})

// --- comparison headers name the actual comparison basis --------------------

test('prior-basis narrative heads the comparison columns "Prior Period", not "Budget"', () => {
  const priorRows = [
    rec({ account: 'Rental Income', actual: 12000, prior: 10000, accountType: 'revenue', category: 'favorable', sourceRows: [1] })
  ]
  const model = buildExcelModel(baseNarrative(priorRows), { generatedDate: FIXED_DATE })
  const headers = model.ownerColumns.map((c) => c.header)
  assert.ok(headers.includes('Current Prior Period'), `expected prior header, got ${headers}`)
  assert.ok(!headers.includes('Current Budget'), 'prior-year figures must not be labeled Budget')

  // Budget-basis narratives keep the default Budget headers.
  const budgetModel = buildExcelModel(baseNarrative(FLAGGED), { generatedDate: FIXED_DATE })
  assert.ok(budgetModel.ownerColumns.some((c) => c.header === 'Current Budget'))
})

// --- generated date is the LOCAL calendar date -------------------------------

test('the Generated meta entry stamps the local click-time date', () => {
  // 11:30 pm local on Dec 31 — a UTC read would roll this into next year for
  // any user west of Greenwich.
  const model = buildExcelModel(baseNarrative(FLAGGED), { generatedDate: new Date(2026, 11, 31, 23, 30) })
  const byLabel = Object.fromEntries(model.meta.map((m) => [m.label, m.value]))
  assert.equal(byLabel['Generated'], '2026-12-31')
})

test('an empty narrative still produces a valid workbook', async () => {
  const empty = generateNarrative({ fileName: 'empty.xlsx', baseClassification: 'Base', comparisonSets: [] })
  const buf = await narrativeToExcelBuffer(empty, { generatedDate: FIXED_DATE })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  assert.ok(wb.getWorksheet(OWNER_SHEET), 'owner sheet exists even with no periods')
})

// --- flagged rows narrated OUTSIDE High Variances keep their Explanation ----
// Since NQ-3B the High Variances section is a concise top-3 headline; the other
// triggered rows are narrated in Revenue Notes / Expense Notes / Context Notes.
// The Excel Owner Summary must pull each flagged row's sentence from WHEREVER it
// was narrated — a flagged line exporting with a blank Explanation is silent
// dropped commentary (regression: rows 4+ used to export blank).

const MANY_FLAGGED = [
  // Two revenue lines + four expense lines, all triggered. Materiality ranking
  // (|variance| desc) promotes the top three to High Variances; the remaining
  // three land in Revenue/Expense Notes.
  rec({ account: 'Base Rent', actual: 90000, budget: 100000, accountType: 'revenue', category: 'unfavorable', sourceRows: [1] }),
  rec({ account: 'Parking Income', actual: 6000, budget: 10000, accountType: 'revenue', category: 'unfavorable', sourceRows: [2] }),
  rec({ account: 'Utilities - Electricity', actual: 21000, budget: 12000, accountType: 'expense', category: 'unfavorable', sourceRows: [3] }),
  rec({ account: 'Janitorial Services', actual: 9500, budget: 8000, accountType: 'expense', category: 'unfavorable', sourceRows: [4] }),
  rec({ account: 'Repairs & Maintenance', actual: 5200, budget: 4000, accountType: 'expense', category: 'unfavorable', sourceRows: [5] }),
  rec({ account: 'Landscaping', actual: 2600, budget: 2000, accountType: 'expense', category: 'unfavorable', sourceRows: [6] })
]

test('every flagged owner row carries its narrative, even when narrated in a category-note section', () => {
  const narrative = baseNarrative(MANY_FLAGGED)
  const period = narrative.periods[0]
  // Preconditions: the headline really is capped and the rest really live elsewhere.
  assert.equal(period.highVariances.length, 3)
  assert.ok(period.revenueNotes.length + period.expenseNotes.length + (period.contextNotes?.length || 0) >= 3)

  const rows = buildOwnerRows(narrative)
  // The Status column names the section each note actually lives in — headline
  // drivers read "High Variance", deferred rows read their category note label.
  const NARRATED_STATUSES = new Set(['High Variance', 'Revenue Note', 'Expense Note', 'Context Note'])
  const flagged = rows.filter((r) => NARRATED_STATUSES.has(r.currentSection))
  assert.equal(flagged.length, MANY_FLAGGED.length)
  for (const row of flagged) {
    assert.ok(
      row.currentNarrative && row.currentNarrative.length > 0,
      `flagged row "${row.account}" exported with a blank Explanation`
    )
    assert.ok(
      row.currentNarrative.includes(row.account),
      `Explanation for "${row.account}" names the account (got: "${row.currentNarrative}")`
    )
  }
})

test('evidence sheet includes support attached to notes in category-note sections', () => {
  const glForJanitorial = supporting({
    fileName: 'GL Detail.pdf',
    type: 'General Ledger (GL)',
    columns: ['Account', 'Vendor', 'Amount'],
    rows: [
      ['Janitorial Services', 'CleanCo', '5000.00'],
      ['Janitorial Services', 'CleanCo', '4500.00']
    ]
  })
  const narrative = baseNarrative(MANY_FLAGGED)
  // Precondition: Janitorial is NOT in the top-3 headline (it is a category note).
  assert.ok(!narrative.periods[0].highVariances.some((n) => /Janitorial/.test(n.account)))

  const enriched = enrichNarrative(narrative, { supporting: [glForJanitorial] })
  const model = buildExcelModel(enriched, { generatedDate: FIXED_DATE })
  const ev = model.evidenceRows.filter((r) => /Janitorial/.test(r.account))
  assert.ok(ev.length >= 1, 'evidence for a category-note row appears on the evidence sheet')
  assert.equal(ev[0].fileName, 'GL Detail.pdf')
})
