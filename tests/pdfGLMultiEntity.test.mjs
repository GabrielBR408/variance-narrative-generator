// --- Multi-entity sectioned GL reconstruction + matching (Phase A) ---------
// A real-world General Ledger that spans several ENTITIES/sites prints each
// account-section heading as "<entity-id> <account-id> <name>" (e.g.
// "715141 40120 Rental Income"). The account id (40120) is the one the income
// statement keys off — the entity id (715141) is a site identifier.
//
// Before the fix, the entity prefix broke heading recognition: the TEXT
// reconstructor dropped the heading entirely (no account section opened → no
// rows → no GL evidence → the narrative fell back to a generic "should be
// reviewed" line), and the POSITION reconstructor kept the heading but extracted
// the entity id as the account code, collapsing the exact-code (1.0) match to a
// fragile substring. These tests lock in that a multi-entity heading reconstructs
// and matches by ACCOUNT id in BOTH paths, while single-entity headings are
// unchanged.
//
// Runs on Node's built-in runner (`node --test`), no extra dependencies. The PDF
// library is never imported — we exercise the pure reconstructors directly.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  reconstructTable,
  reconstructSectionedGLFromText,
  groupItemsIntoLineCells,
  GL_COLUMNS
} from '../src/lib/extract/pdfTable.js'
import { normalize } from '../src/lib/extract/normalize.js'
import { buildEvidenceIndex, matchAccount, accountCode } from '../src/lib/enrich/match.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'

function asMapped(row) {
  const out = {}
  GL_COLUMNS.forEach((col, i) => (out[col] = row[i]))
  return out
}

// A Northpark-style multi-entity sectioned GL, x-sorted TEXT lines. Sites 715141
// / 715142 / 715143, an "Account Id Code" column, "Balance Forward" section
// openers, a "*** FISCAL YEAR END ***" marker, and "** Account Totals" closers.
// The SAME account (40120) recurs under two different sites.
function northparkTextLines() {
  return [
    'Entity Period Account Id Code Description Date Src Reference Debit Credit Balance',
    '715141 40120 Rental Income Balance Forward 0.00',
    '715141 04/26 4/30/2026 RR1001 Monthly rent billing 75000.00 0.00 75000.00',
    '715141 04/26 4/30/2026 RR1002 Parking income 5000.00 0.00 80000.00',
    '** Account Totals 80000.00 0.00 80000.00',
    '715141 51051 Security Contract Balance Forward 0.00',
    '715141 04/26 4/30/2026 CHK1200 Monthly security SecureGuard 4000.00 0.00 4000.00',
    '** Account Totals 4000.00 0.00 4000.00',
    '*** FISCAL YEAR END ***',
    '715142 40120 Rental Income Balance Forward 0.00',
    '715142 04/26 4/30/2026 RR2001 Monthly rent billing 60000.00 0.00 60000.00',
    '** Account Totals 60000.00 0.00 60000.00',
    '715143 53110 Repairs Building Balance Forward 0.00',
    '715143 04/26 4/30/2026 AP3001 HVAC repair AcmeMech 12000.00 0.00 12000.00',
    '** Account Totals 12000.00 0.00 12000.00'
  ]
}

// --- text path -------------------------------------------------------------

test('text path: multi-entity headings reconstruct and key off the ACCOUNT id', () => {
  const table = reconstructSectionedGLFromText(northparkTextLines())
  assert.ok(table, 'a table is reconstructed (was null before the fix)')
  const data = table.rows.slice(1).map(asMapped)
  // 5 transactions (40120 recurs under two sites); Balance Forward / Account
  // Totals / FISCAL YEAR END are all excluded.
  assert.equal(data.length, 5)

  // The entity id (715141…) is stripped; the account id (40120) leads the label.
  assert.deepEqual(
    data.map((r) => r.Account),
    ['40120 Rental Income', '40120 Rental Income', '51051 Security Contract', '40120 Rental Income', '53110 Repairs Building']
  )
  for (const r of data) {
    assert.doesNotMatch(r.Account, /715141|715142|715143/, 'no entity id leaks into the account label')
  }
  // A clean transaction parses: real reference, description, debit amount.
  assert.equal(data[0].Reference, 'RR1001')
  assert.equal(data[0].Description, 'Monthly rent billing')
  assert.equal(data[0].Amount, '75000')
})

test('text path: account ids are the matchable code (not the entity id)', () => {
  const table = reconstructSectionedGLFromText(northparkTextLines())
  for (const row of table.rows.slice(1)) {
    assert.equal(accountCode(row[0]), row[0].split(' ')[0], 'leading token is the account id')
    assert.match(accountCode(row[0]), /^(40120|51051|53110)$/)
  }
})

test('text path routes through reconstructTable (GL by content alone)', () => {
  const table = reconstructTable(northparkTextLines(), {})
  assert.ok(table && table.name === 'Reconstructed GL')
  assert.equal(table.rows.length - 1, 5)
})

// --- position path ---------------------------------------------------------

const item = (str, x, eol = false) => ({ str, transform: [1, 0, 0, 1, x, 700], hasEOL: eol })
function line(cells) {
  const items = cells.map(([s, x]) => item(s, x))
  items[items.length - 1].hasEOL = true
  return items
}
function doc(lines) {
  return lines.flatMap(line)
}

// x-bands for a stacked multi-entity header with Debit/Credit/Balance columns.
const X = { entity: 26, period: 70, acct: 120, desc: 175, date: 330, ref: 395, debit: 520, credit: 590, balance: 665 }

test('position path: entity-prefixed heading keeps the ACCOUNT id, matches at exact_code', () => {
  const lines = [
    [['Description', X.desc], ['Debit', X.debit], ['Credit', X.credit]], // anchor (debit+credit)
    [['Entity', X.entity], ['Period', X.period], ['Account Id Code', X.acct]],
    [['Date', X.date], ['Src Reference', X.ref], ['Balance', X.balance]],
    [['715141', X.entity], ['40120', X.acct], ['Rental Income', X.desc], ['Balance Forward', 440], ['0.00', X.balance]],
    [['715141', X.entity], ['04/26', X.period], ['4/30/2026', X.date], ['RR1001', X.ref], ['Monthly rent', X.desc], ['75000.00', X.debit], ['0.00', X.credit], ['75000.00', X.balance]],
    [['715142', X.entity], ['51051', X.acct], ['Security Contract', X.desc], ['Balance Forward', 440], ['0.00', X.balance]],
    [['715142', X.entity], ['04/26', X.period], ['4/30/2026', X.date], ['CHK1200', X.ref], ['Monthly security', X.desc], ['4000.00', X.debit], ['0.00', X.credit], ['4000.00', X.balance]]
  ]
  const lineCells = groupItemsIntoLineCells(doc(lines))
  const lineStrings = lineCells.map((cells) => cells.map((c) => c.str).join(' '))
  const table = reconstructTable(lineStrings, { lineCells, classificationType: 'General Ledger (GL)' })

  const data = table.rows.slice(1).map(asMapped)
  assert.deepEqual(
    data.map((r) => r.Account),
    ['40120 Rental Income', '51051 Security Contract']
  )
  assert.equal(data[0].Amount, '75000')
  assert.equal(data[0].Reference, 'RR1001')
  assert.doesNotMatch(data[0].Reference, /715141/, 'entity id is absorbed, not used as the reference')

  // The income statement (keyed by account id) matches each GL section at the
  // strongest tier — exact account code — exactly as a single-entity GL does.
  const { normalized } = normalize({ tables: [table] }, 'pdf')
  const idx = buildEvidenceIndex([{ fileName: 'Northpark GL.pdf', status: 'ok', classification: { type: 'General Ledger (GL)' }, normalized }])
  for (const [is, code] of [['40120 Rental Income', '40120'], ['51051 Security Contract', '51051']]) {
    const cites = matchAccount(is, idx)
    assert.equal(cites.length, 1, `${is} has a citation`)
    assert.equal(cites[0].confidence, 1, `${is} matches by exact code`)
    assert.equal(cites[0].matchMethod, 'exact_code')
    assert.ok(cites[0].thick)
  }
})

// --- single-entity regression ----------------------------------------------

test('single-entity headings are unchanged (no over-stripping)', () => {
  const table = reconstructSectionedGLFromText([
    'Period Entry Date Src Reference Description Debit Credit Balance',
    '54110 Real Estate Taxes',
    'Balance Forward 0.00',
    '29298 01/26 4/30/2026 GS 00084362 Accrued RE Tax 75242.55 0.00 75242.55',
    '** Account Totals 75242.55 0.00 75242.55'
  ])
  const r = asMapped(table.rows[1])
  assert.equal(r.Account, '54110 Real Estate Taxes', 'one leading code is kept intact')
  assert.equal(accountCode(r.Account), '54110')
  assert.equal(r.Amount, '75242.55')
})

// --- evidence index: same account across sites collapses by code -----------

test('the same account under two sites matches one income-statement line', () => {
  const table = reconstructTable(northparkTextLines(), { classificationType: 'General Ledger (GL)' })
  const { normalized } = normalize({ tables: [table] }, 'pdf')
  const idx = buildEvidenceIndex([{ fileName: 'Northpark GL.pdf', status: 'ok', classification: { type: 'General Ledger (GL)' }, normalized }])

  // 40120 appears under 715141 (two txns) and 715142 (one txn) → one citation,
  // exact code, covering all three rows.
  const cites = matchAccount('40120 Rental Income', idx)
  assert.equal(cites.length, 1)
  assert.equal(cites[0].confidence, 1)
  assert.equal(cites[0].sourceRows.length, 3, 'all three 40120 rows across sites are gathered')
})

// --- end-to-end: GL-cited evidence replaces the generic fallback -----------

test('a flagged note gets GL-cited evidence, not the generic "should be reviewed"', () => {
  const table = reconstructTable(northparkTextLines(), { classificationType: 'General Ledger (GL)' })
  const { normalized } = normalize({ tables: [table] }, 'pdf')
  const gl = { fileName: 'Northpark GL.pdf', status: 'ok', classification: { type: 'General Ledger (GL)' }, normalized }

  const actual = 12000
  const budget = 4000
  const varianceAmount = actual - budget
  const base = generateNarrative({
    fileId: 'base',
    fileName: 'Comparative Income Statement.pdf',
    baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [
      {
        period: 'current',
        comparisons: [
          {
            account: '53110 Repairs Building',
            actual,
            budget,
            prior: null,
            varianceAmount,
            variancePercent: (varianceAmount / Math.abs(budget)) * 100,
            comparisonType: 'budget',
            thresholdTriggered: true,
            category: 'unfavorable',
            accountType: 'expense',
            missingData: false,
            confidence: 90,
            sourceRows: [3]
          }
        ]
      }
    ]
  })

  const enriched = enrichNarrative(base, { supporting: [gl] })
  const note = enriched.periods[0].highVariances.find((n) => n.account === '53110 Repairs Building')
  assert.ok(note.enriched, 'the note is enriched from GL evidence')
  assert.ok(note.support && note.support[0].thick, 'thick GL support is attached')
  assert.equal(note.support[0].matchMethod, 'exact_code')
  assert.doesNotMatch(note.text, /should be reviewed with supporting detail/, 'no generic fallback')
})
