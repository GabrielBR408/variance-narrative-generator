// OCR tests — scanned PDF GL via Claude vision
//
// The page rendering (browser canvas) and the live vision call are not unit
// tested here; the PURE, deterministic pieces are: the vision-JSON → GL-table
// mapping, the tolerant response parser, the message/content builder, the
// server gating (OFF by default → silent), and the full data path
// (accounts → normalize → evidence index → matchAccount).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { accountsToTable, toAmountString } from '../src/lib/ocr/ocrTable.js'
import { parseOcrResponse, buildOcrContent, handleOcr, OCR_ENABLED } from '../server/ocr.js'
import { GL_COLUMNS } from '../src/lib/extract/pdfTable.js'
import { normalize } from '../src/lib/extract/normalize.js'
import { buildEvidenceIndex, matchAccount } from '../src/lib/enrich/match.js'

// --- amount coercion -------------------------------------------------------

test('toAmountString handles numbers, formatted strings, parentheses, and junk', () => {
  assert.equal(toAmountString(1500), '1500')
  assert.equal(toAmountString(-250.5), '-250.5')
  assert.equal(toAmountString('$3,000.00'), '3000')
  assert.equal(toAmountString('(120.00)'), '-120') // accounting negative
  assert.equal(toAmountString(''), '')
  assert.equal(toAmountString('n/a'), '')
  assert.equal(toAmountString(Infinity), '')
})

// --- vision JSON → GL table ------------------------------------------------

const VISION_ACCOUNTS = [
  {
    account: '51053 HVAC Contract',
    transactions: [
      { date: '01/15/2026', reference: 'CHK1042', description: 'Monthly HVAC service ABC Mechanical', amount: 3000 },
      { date: '02/15/2026', reference: 'CHK1099', description: 'Monthly HVAC service ABC Mechanical', amount: 3000 }
    ]
  },
  {
    account: '51051 Security Contract',
    transactions: [{ date: '01/20/2026', reference: 'CHK1200', description: 'Monthly security SecureGuard LLC', amount: 4000 }]
  },
  {
    account: '51052 Janitorial Contract',
    transactions: [{ date: '01/31/2026', reference: 'CHK1100', description: 'Janitorial CleanCo Services', amount: 4500 }]
  }
]

test('accountsToTable flattens vision accounts into GL_COLUMNS rows', () => {
  const table = accountsToTable(VISION_ACCOUNTS)
  assert.deepEqual(table.rows[0], GL_COLUMNS.slice())
  const data = table.rows.slice(1)
  assert.equal(data.length, 4)
  assert.deepEqual(data[0], ['51053 HVAC Contract', '01/15/2026', 'CHK1042', '', 'Monthly HVAC service ABC Mechanical', '3000'])
  // The section account is carried onto every transaction row.
  assert.deepEqual(
    data.map((r) => r[0]),
    ['51053 HVAC Contract', '51053 HVAC Contract', '51051 Security Contract', '51052 Janitorial Contract']
  )
})

test('accountsToTable drops empty rows / accounts and returns null when nothing usable', () => {
  const table = accountsToTable([
    { account: 'Some Account', transactions: [{ date: '', reference: '', description: '', amount: '' }] }, // no content
    { account: '', transactions: [{ amount: 100 }] } // no account name
  ])
  assert.equal(table, null)
})

test('a credit (negative) amount survives into the table', () => {
  const table = accountsToTable([{ account: '5100 Repairs', transactions: [{ date: '03/01/2026', description: 'Refund', amount: -250 }] }])
  assert.equal(table.rows[1][5], '-250')
})

// --- tolerant response parsing ---------------------------------------------

test('parseOcrResponse reads plain JSON, fenced JSON, and prose-wrapped JSON', () => {
  const obj = '{"accounts":[{"account":"5100 Repairs","transactions":[{"amount":10}]}]}'
  assert.equal(parseOcrResponse(obj)[0].account, '5100 Repairs')
  assert.equal(parseOcrResponse('```json\n' + obj + '\n```')[0].account, '5100 Repairs')
  assert.equal(parseOcrResponse('Here is the data:\n' + obj + '\nThanks!')[0].account, '5100 Repairs')
})

test('parseOcrResponse returns [] for unparseable or empty input, and sanitizes shape', () => {
  assert.deepEqual(parseOcrResponse('not json at all'), [])
  assert.deepEqual(parseOcrResponse(''), [])
  // Garbage entries are dropped; a valid account with a clean transaction remains.
  const out = parseOcrResponse('{"accounts":[{"account":""},{"account":"X","transactions":[{"amount":5,"date":"1/1/26"}]}]}')
  assert.equal(out.length, 1)
  assert.equal(out[0].account, 'X')
  assert.equal(out[0].transactions[0].amount, 5)
})

// --- message content builder -----------------------------------------------

test('buildOcrContent adds an image block per valid data URL and appends the prompt', () => {
  const content = buildOcrContent([
    'data:image/png;base64,AAAA',
    'data:image/jpeg;base64,BBBB',
    'not-a-data-url' // skipped
  ])
  const images = content.filter((b) => b.type === 'image')
  assert.equal(images.length, 2)
  assert.equal(images[0].source.media_type, 'image/png')
  assert.equal(images[0].source.data, 'AAAA')
  const text = content.filter((b) => b.type === 'text')
  assert.equal(text.length, 1)
  assert.match(text[0].text, /General Ledger/i)
})

// --- server gating (OFF by default → silent) -------------------------------

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) {
      this.headers[k] = v
    },
    end(s) {
      this.body = s
    }
  }
}

test('OCR is feature-flagged OFF by default', () => {
  assert.equal(OCR_ENABLED, false)
})

test('handleOcr is a silent no-op when OCR is disabled (no body read, no model call)', async () => {
  const res = mockRes()
  await handleOcr({ method: 'POST', headers: {} }, res)
  assert.equal(res.statusCode, 200)
  // The mode is unknown on the disabled early-exit, so BOTH empty shapes are
  // returned — an incomeStatement caller reading `rows` must get [], not undefined.
  assert.deepEqual(JSON.parse(res.body), { success: true, accounts: [], rows: [] })
})

test('handleOcr rejects a non-POST method', async () => {
  const res = mockRes()
  await handleOcr({ method: 'GET', headers: {} }, res)
  assert.equal(res.statusCode, 405)
})

// --- full data path: OCR table → normalize → evidence index → match --------

test('OCR rows flow through normalize + the evidence index and match the contract accounts', () => {
  const table = accountsToTable(VISION_ACCOUNTS)
  const { normalized } = normalize({ tables: [table] }, 'pdf')
  assert.deepEqual(normalized.columns, GL_COLUMNS.slice())
  const idx = buildEvidenceIndex([
    { fileName: 'Scanned GL.pdf', status: 'ok', classification: { type: 'General Ledger (GL)' }, normalized }
  ])
  assert.equal(idx.length, 4)
  const totals = { 'HVAC Contract': 6000, 'Janitorial Contract': 4500, 'Security Contract': 4000 }
  for (const account of Object.keys(totals)) {
    const cites = matchAccount(account, idx)
    assert.equal(cites.length, 1, `${account} has a citation`)
    assert.equal(cites[0].confidence, 0.9)
    assert.equal(cites[0].thick, true)
    assert.equal(cites[0].detail.total, totals[account])
  }
})
