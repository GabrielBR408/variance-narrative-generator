// Standalone repro for the production YTD bug. Loads the REAL parser pipeline
// (no source edits) and drives it with the exact header structure reported from
// production, then asserts the YTD fields on the parsed Rental row.
//
// Run: node scripts/ytd-repro.mjs
import { normalize } from '../src/lib/extract/normalize.js'
import { computeVariance } from '../src/lib/variance/index.js'
import { detectComparisonSets } from '../src/lib/variance/detectColumns.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { buildExcelModel } from '../src/lib/export/excel.js'

// The spreadsheet parser hands the grid over already stringified (cellToText),
// so dates arrive as ISO strings and blank cells as ''. Mirror that here.
const D = '2024-04-30'
const GRID = [
  // Row 8: merged period band — note "Year-To-Date" sits at index 6 (over YTD
  // Budget), NOT index 5 where the YTD section actually begins.
  ['', 'Current Period', '', '', '', '', 'Year-To-Date', '', ''],
  // Row 9: value sub-headers — Actual/Budget under each period.
  ['', 'Actual', 'Budget', '', '', 'Actual', 'Budget', '', ''],
  // Row 10: a "Thru:" date row that also carries the literal word "Variance".
  ['Thru:', D, D, 'Variance', '', D, D, 'Variance', ''],
  // Data row — the confirmed production figures.
  ['Rental Inc. - Commercial', '661061.20', '661061.20', '0', '0', '2644244.80', '2644244.80', '0', '0']
]

function spreadsheet(grid) {
  return { text: [], tables: [{ name: 'Sheet1', rows: grid, columnCount: grid[0].length }], metadata: {} }
}

const { normalized, confidence } = normalize(spreadsheet(GRID), 'spreadsheet')
console.log('FOLDED COLUMNS:', JSON.stringify(normalized.columns))

const sets = detectComparisonSets(normalized.columns, normalized.rows)
console.log('PERIODS:', sets.sets.map((s) => s.period))
console.log('YTD COLUMN MAP:', JSON.stringify(sets.sets.find((s) => s.period === 'ytd')?.columns))

const result = computeVariance({
  fileId: 'f1', fileName: 'income-statement.xlsx', status: 'ok',
  confidence, classification: { type: 'variance-report' }, normalized
})
const model = buildExcelModel(generateNarrative(result), {})
const rental = model.ownerRows.find((r) => /Rental Inc\. - Commercial/.test(r.account))

const parsed = rental
  ? {
      ytdActual: rental.ytdActual,
      ytdBudget: rental.ytdComparison,
      ytdVariance: rental.ytdVarianceAmount,
      ytdVariancePct: rental.ytdVariancePercent
    }
  : null
console.log('PARSED RENTAL YTD:', JSON.stringify(parsed))

const expected = { ytdActual: 2644244.8, ytdBudget: 2644244.8, ytdVariance: 0, ytdVariancePct: 0 }
const ok = parsed &&
  parsed.ytdActual === expected.ytdActual &&
  parsed.ytdBudget === expected.ytdBudget &&
  parsed.ytdVariance === expected.ytdVariance &&
  parsed.ytdVariancePct === expected.ytdVariancePct

console.log('EXPECTED:', JSON.stringify(expected))
if (ok) {
  console.log('\n✅ PASS — YTD fields parsed correctly')
  process.exit(0)
} else {
  console.log('\n❌ FAIL — YTD fields are wrong/null')
  process.exit(1)
}
