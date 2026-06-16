// --- GL reconstruction tests — Phase 18A ----------------------------------
// Deterministic checks for General Ledger transaction-row reconstruction from
// position-aware PDF line cells, and for how that reconstructed table flows
// through the existing supporting-evidence engine (thick evidence, reliable
// total, recurring vendor) WITHOUT any narrative-wording changes.
//
// Runs on Node's built-in runner (`node --test`), no extra dependencies. The PDF
// library is never imported here — we synthesize pdf.js-shaped text items (with
// x-positions and end-of-line markers) and exercise the pure reconstructor.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  reconstructTable,
  groupItemsIntoLineCells,
  looksLikeGL,
  GL_COLUMNS
} from '../src/lib/extract/pdfTable.js'
import { buildEvidenceIndex, matchAccount } from '../src/lib/enrich/match.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'

// --- pdf.js item / line builders ------------------------------------------

const item = (str, x, eol = false) => ({ str, transform: [1, 0, 0, 1, x, 700], hasEOL: eol })

// Build one visual line from [str, x] cells; the last item carries the EOL.
function line(cells) {
  const items = cells.map(([s, x]) => item(s, x))
  items[items.length - 1].hasEOL = true
  return items
}

// Concatenate lines (each an array of [str, x] cells) into one item stream.
function doc(lines) {
  return lines.flatMap((cells) => line(cells))
}

// Standard GL column x-bands used across the fixtures.
const X = { date: 50, num: 110, name: 170, memo: 260, debit: 380, credit: 450, balance: 530 }
const HEADER = [
  ['Date', X.date],
  ['Num', X.num],
  ['Name', X.name],
  ['Memo', X.memo],
  ['Debit', X.debit],
  ['Credit', X.credit],
  ['Balance', X.balance]
]

// Reconstruct a GL table from line specs (arrays of [str, x] cells).
function buildGL(lines) {
  const items = doc(lines)
  const lineCells = groupItemsIntoLineCells(items)
  const lineStrings = lineCells.map((cells) => cells.map((c) => c.str).join(' '))
  return reconstructTable(lineStrings, { lineCells, classificationType: 'General Ledger (GL)' })
}

// Map a reconstructed row to a {column: value} object for readable asserts.
function asMapped(row) {
  const out = {}
  GL_COLUMNS.forEach((col, i) => {
    out[col] = row[i]
  })
  return out
}

// --- account-section heading inheritance -----------------------------------

test('account-section heading propagates to its transaction rows', () => {
  const table = buildGL([
    HEADER,
    [['Utility-Elect-Building', X.date]],
    [['01/05/2026', X.date], ['101', X.num], ['PG&E', X.name], ['Electric', X.memo], ['100.00', X.debit]],
    [['01/20/2026', X.date], ['102', X.num], ['PG&E', X.name], ['Electric', X.memo], ['200.00', X.debit]],
    [['Insurance-Building', X.date]],
    [['02/01/2026', X.date], ['200', X.num], ['Acme Ins', X.name], ['50.00', X.debit]]
  ])

  assert.deepEqual(table.rows[0], GL_COLUMNS.slice())
  const data = table.rows.slice(1).map(asMapped)
  assert.equal(data.length, 3)
  assert.equal(data[0].Account, 'Utility-Elect-Building')
  assert.equal(data[1].Account, 'Utility-Elect-Building')
  assert.equal(data[2].Account, 'Insurance-Building')
  assert.deepEqual(table.sections, ['Utility-Elect-Building', 'Insurance-Building'])
})

// --- debit / credit / blank-cell handling ----------------------------------

test('debit-only row nets positive; blank credit cell is not misread', () => {
  const table = buildGL([
    HEADER,
    [['Repairs', X.date]],
    [['03/01/2026', X.date], ['PG&E', X.name], ['100.00', X.debit]]
  ])
  const row = asMapped(table.rows[1])
  assert.equal(row.Amount, '100')
  assert.equal(row.Vendor, 'PG&E')
})

test('credit-only row nets negative; blank debit cell is not misread', () => {
  const table = buildGL([
    HEADER,
    [['Repairs', X.date]],
    [['03/02/2026', X.date], ['Refund', X.name], ['20.00', X.credit]]
  ])
  const row = asMapped(table.rows[1])
  assert.equal(row.Amount, '-20')
})

test('a row carrying both debit and credit nets the difference', () => {
  const table = buildGL([
    HEADER,
    [['Repairs', X.date]],
    [['03/03/2026', X.date], ['Adj', X.name], ['100.00', X.debit], ['30.00', X.credit]]
  ])
  assert.equal(asMapped(table.rows[1]).Amount, '70')
})

// --- vendor / description / reference split ---------------------------------

test('reference, vendor and description columns are populated by band', () => {
  const table = buildGL([
    HEADER,
    [['Repairs', X.date]],
    [['03/04/2026', X.date], ['305', X.num], ['Acme', X.name], ['HVAC repair', X.memo], ['500.00', X.debit]]
  ])
  const row = asMapped(table.rows[1])
  assert.equal(row.Date, '03/04/2026')
  assert.equal(row.Reference, '305')
  assert.equal(row.Vendor, 'Acme')
  assert.equal(row.Description, 'HVAC repair')
  assert.equal(row.Amount, '500')
})

// --- wrapped description ----------------------------------------------------

test('a wrapped memo line appends to the previous transaction, not a new row', () => {
  const table = buildGL([
    HEADER,
    [['Repairs', X.date]],
    [['03/05/2026', X.date], ['Bob', X.name], ['Fix', X.memo], ['75.00', X.debit]],
    [['additional notes here', X.memo]]
  ])
  const data = table.rows.slice(1)
  assert.equal(data.length, 1, 'continuation must not create a new transaction row')
  assert.match(asMapped(data[0]).Description, /Fix additional notes here/)
})

// --- total / subtotal exclusion --------------------------------------------

test('total / subtotal lines are not counted as transactions', () => {
  const table = buildGL([
    HEADER,
    [['Utility-Elect-Building', X.date]],
    [['01/05/2026', X.date], ['PG&E', X.name], ['100.00', X.debit]],
    [['01/20/2026', X.date], ['PG&E', X.name], ['200.00', X.debit]],
    [['Total', X.date], ['Utility-Elect-Building', X.num], ['300.00', X.debit]]
  ])
  const data = table.rows.slice(1)
  assert.equal(data.length, 2)
  assert.ok(
    data.every((r) => !/^total/i.test(r[0]) && r[1] !== ''),
    'every reconstructed row is a dated transaction, not a total'
  )
})

// --- ambiguous amount → null -----------------------------------------------

test('an amount token equidistant between Debit and Credit yields no amount', () => {
  const ambiguousX = (X.debit + X.credit) / 2 // exactly between the two bands
  const table = buildGL([
    HEADER,
    [['Repairs', X.date]],
    [['03/06/2026', X.date], ['Vend', X.name], ['99.00', ambiguousX]]
  ])
  const row = asMapped(table.rows[1])
  assert.equal(row.Amount, '', 'ambiguous band ⇒ no guessed amount')
  assert.equal(row.Vendor, 'Vend', 'row is still kept for count / vendor evidence')
})

// --- reconstructed GL produces THICK evidence (engine integration) ----------

test('reconstructed GL yields thick evidence with a reliable total and recurring vendor', () => {
  const table = buildGL([
    HEADER,
    [['Utility-Elect-Building', X.date]],
    [['01/05/2026', X.date], ['101', X.num], ['PG&E', X.name], ['Electric', X.memo], ['100.00', X.debit]],
    [['01/20/2026', X.date], ['102', X.num], ['PG&E', X.name], ['Electric', X.memo], ['200.00', X.debit]]
  ])
  const ex = {
    fileName: '4. General Ledger.pdf',
    status: 'ok',
    classification: { type: 'General Ledger (GL)' },
    normalized: { columns: table.rows[0], rows: table.rows.slice(1) }
  }
  const index = buildEvidenceIndex([ex])
  const cites = matchAccount('Utility-Elect-Building', index)
  assert.equal(cites.length, 1)
  const c = cites[0]
  assert.equal(c.thick, true)
  assert.equal(c.detail.count, 2)
  assert.equal(c.detail.total, 300)
  assert.equal(c.detail.topVendor, 'PG&E')
  assert.equal(c.detail.topVendorCount, 2)
})

test('an ambiguous row keeps the GL thick but suppresses the total (no guessed sum)', () => {
  const ambiguousX = (X.debit + X.credit) / 2
  const table = buildGL([
    HEADER,
    [['Utility-Elect-Building', X.date]],
    [['01/05/2026', X.date], ['PG&E', X.name], ['100.00', X.debit]],
    [['01/20/2026', X.date], ['PG&E', X.name], ['99.00', ambiguousX]]
  ])
  const ex = {
    fileName: 'gl.pdf',
    status: 'ok',
    classification: { type: 'General Ledger (GL)' },
    normalized: { columns: table.rows[0], rows: table.rows.slice(1) }
  }
  const cites = matchAccount('Utility-Elect-Building', buildEvidenceIndex([ex]))
  assert.equal(cites[0].thick, true)
  assert.equal(cites[0].detail.count, 2)
  assert.equal(cites[0].detail.total, null, 'a partial/ambiguous total must not be presented')
})

// --- full narrative integration (existing wording, no causation) -----------

function flaggedNarrative() {
  // A self-consistent flagged note matching calculate.js output, mirroring the
  // shape used in test/enrich.test.js.
  const actual = 12700
  const budget = 5334
  const varianceAmount = actual - budget
  const variancePercent = (varianceAmount / Math.abs(budget)) * 100
  return generateNarrative({
    fileId: 'base',
    fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [
      {
        period: 'current',
        comparisons: [
          {
            account: 'Utility-Elect-Building',
            actual,
            budget,
            prior: null,
            varianceAmount,
            variancePercent,
            comparisonType: 'budget',
            thresholdTriggered: true,
            category: 'unfavorable',
            accountType: 'expense',
            missingData: false,
            confidence: 90,
            sourceRows: [4]
          }
        ]
      }
    ]
  })
}

test('reconstructed GL drives the existing thick sentence — no filename, no causation', () => {
  const table = buildGL([
    HEADER,
    [['Utility-Elect-Building', X.date]],
    [['01/05/2026', X.date], ['101', X.num], ['PG&E', X.name], ['Electric', X.memo], ['100.00', X.debit]],
    [['01/20/2026', X.date], ['102', X.num], ['PG&E', X.name], ['Electric', X.memo], ['200.00', X.debit]]
  ])
  const ex = {
    fileName: '4. General Ledger.pdf',
    status: 'ok',
    classification: { type: 'General Ledger (GL)' },
    normalized: { columns: table.rows[0], rows: table.rows.slice(1) }
  }
  const enriched = enrichNarrative(flaggedNarrative(), { supporting: [ex] })
  const note = enriched.periods[0].highVariances.find((x) => x.account === 'Utility-Elect-Building')
  assert.ok(note.enriched)
  assert.equal(note.support[0].thick, true)
  // Phase 19B: the GL total ($300) is a tiny fraction of the $7,366 variance
  // (ratio ≈ 0.04 < 0.25) → contribution is "partial", so the owner sees the
  // figure framed as only a portion of the movement — not as concentrated
  // activity that explains the swing.
  assert.match(note.text, /Related activity totaled approximately \$300, accounting for a portion of the total movement\./)
  assert.doesNotMatch(note.text, /Account-level activity was available for review/)
  assert.doesNotMatch(note.text, /General Ledger\.pdf|Supporting file/)
  assert.doesNotMatch(note.text, /due to|driven by|caused by|because of|explains|resulting from/)
})

// --- real-world MRI layout regressions (Phase 18A correction) --------------
// A stacked header (Debit/Credit on one line, Balance on another, Date/Reference
// elsewhere) with an entity column and a "Balance Forward" account heading —
// mirroring MRI Software's General Ledger export.

// x-bands taken from the real MRI layout.
const MX = { entity: 26, period: 70, date: 100, ref: 153, marker: 208, memo: 307, debit: 552, credit: 622, balance: 695 }
const MRI_HEADER = [
  [['Description', MX.memo], ['Debit', MX.debit], ['Credit', MX.credit]], // anchor (debit+credit)
  [['Entity', 34], ['Period', 67]],
  [['Date', 109], ['Src Reference', MX.ref]],
  [['Balance', 691]]
]

function buildMRI(bodyLines) {
  return buildGL([...MRI_HEADER, ...bodyLines])
}

test('stacked header: Balance band detected on a separate line → 3-token rows net Debit−Credit', () => {
  const table = buildMRI([
    [['54110 Real Estate Taxes', MX.entity], ['Balance Forward', MX.memo], ['0.00', 706]],
    [['29298', MX.entity], ['04/26', MX.period], ['4/30/2026', MX.date], ['GS 00084362', MX.ref], ['@', MX.marker], ['Accrued RE Tax', MX.memo], ['75242.55', 547], ['0.00', 627], ['75242.55', MX.balance]]
  ])
  const r = asMapped(table.rows[1])
  assert.equal(r.Account, '54110 Real Estate Taxes', 'Balance Forward line sets the account section')
  assert.equal(r.Amount, '75242.55', '3 money tokens map to Debit/Credit/Balance; amount = debit − credit')
})

test('entity/account number is absorbed (sink), real Src Reference captured', () => {
  const table = buildMRI([
    [['54110 Real Estate Taxes', MX.entity], ['Balance Forward', MX.memo], ['0.00', 706]],
    [['29298', MX.entity], ['04/26', MX.period], ['4/30/2026', MX.date], ['GS 00084362', MX.ref], ['@', MX.marker], ['Accrued RE Tax', MX.memo], ['75242.55', 547], ['0.00', 627], ['75242.55', MX.balance]]
  ])
  const r = asMapped(table.rows[1])
  assert.equal(r.Reference, 'GS 00084362', 'reference is the Src Reference, not the entity number')
  assert.doesNotMatch(r.Reference, /29298/, 'entity number must not land in Reference')
  assert.doesNotMatch(r.Vendor, /29298/)
  assert.equal(r.Description, 'Accrued RE Tax')
})

test('"Balance Forward" account headings prevent mis-attribution of short sections', () => {
  const table = buildMRI([
    [['51101 Fire Sprinkler - Contract', MX.entity], ['Balance Forward', MX.memo], ['725.00', 697]],
    [['29298', MX.entity], ['04/26', MX.period], ['4/30/2026', MX.date], ['GS 00084365', MX.ref], ['Accrue Sprinkler', MX.memo], ['483.33', 547], ['0.00', 627], ['966.66', MX.balance]],
    [['51103 Fire Sprinkler-Inspection', MX.entity], ['Balance Forward', MX.memo], ['0.00', 706]],
    [['29298', MX.entity], ['04/26', MX.period], ['4/30/2026', MX.date], ['GS 00084368', MX.ref], ['Annual FA testing', MX.memo], ['0.00', 547], ['120.00', 627], ['160.00', MX.balance]]
  ])
  const data = table.rows.slice(1).map(asMapped)
  assert.equal(data[0].Account, '51101 Fire Sprinkler - Contract')
  assert.equal(data[1].Account, '51103 Fire Sprinkler-Inspection', 'second short section is not attributed to the first')
  assert.equal(data[0].Amount, '483.33')
  assert.equal(data[1].Amount, '-120') // 0 − 120
})

test('"** Account Totals" lines are excluded from transactions', () => {
  const table = buildMRI([
    [['54110 Real Estate Taxes', MX.entity], ['Balance Forward', MX.memo], ['0.00', 706]],
    [['29298', MX.entity], ['4/30/2026', MX.date], ['GS 00084362', MX.ref], ['Accrued RE Tax', MX.memo], ['100.00', 547], ['0.00', 627], ['100.00', MX.balance]],
    [['** Account Totals', 268], ['100.00', 548], ['0.00', 619], ['100.00', MX.balance]]
  ])
  const data = table.rows.slice(1)
  assert.equal(data.length, 1, 'the ** Account Totals line is not a transaction')
})

test('a money value leaking into the description suppresses the amount (no skewed total)', () => {
  const table = buildMRI([
    [['14811 WIP - Capital Improvements', MX.entity], ['Balance Forward', MX.memo], ['0.00', 706]],
    // Long vendor name wraps the value into the description region (x≈430), and
    // the debit/credit columns read 0 — the columnar parse is unreliable.
    [['29298', MX.entity], ['4/13/2026', MX.date], ['AP 064697', MX.ref], ['Furniture TWO', MX.memo], ['5,652.22', 430], ['ONE WORKPLACE', 470], ['0.00', 547], ['0.00', 627], ['12345.00', MX.balance]]
  ])
  const r = asMapped(table.rows[1])
  assert.equal(r.Amount, '', 'a money token in the description ⇒ amount is suppressed, not 0')
})

// --- variance reconstruction is unchanged ----------------------------------

test('variance PDF reconstruction is unchanged (GL path not triggered)', () => {
  const HEADER_ROW = 'Account Actual Budget Variance Var% YTD Actual YTD Budget YTD Variance YTD Var%'
  const UTILITY_ROW =
    'Utility-Elect-Building 614.81 530.00 (84.81) -16.00% 5,896.96 5,420.00 (476.96) -8.80%'
  assert.equal(looksLikeGL([HEADER_ROW, UTILITY_ROW]), false)
  const table = reconstructTable([HEADER_ROW, UTILITY_ROW])
  assert.equal(table.name, 'Reconstructed')
  assert.equal(table.rows[1][0], 'Utility-Elect-Building')
  assert.equal(table.rows[1][1], '614.81')
  assert.equal(table.rows[1][3], '-84.81')
})
