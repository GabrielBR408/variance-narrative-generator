// Fix 3 regression — the row-cap truncation warning must reach the user.
//
// The extractor already set metadata.truncated when a file exceeded its row cap
// (MAX_ROWS for a flat file, SECTIONED_GL_MAX_ROWS for an account-sectioned GL),
// but NOTHING rendered it — so a real variance past the cap was silently dropped.
// These pin the pure helper, prove BOTH caps set the flag, and render the ACTUAL
// component (react-dom/server) so a regression where the warning stops showing
// fails CI (mirrors renderBackupNotice.test.js).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, unlink } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as esbuild from 'esbuild'
import * as XLSX from 'xlsx'

import { truncationNotices } from '../src/lib/truncationNotice.js'
import { extractSpreadsheet, SECTIONED_GL_MAX_ROWS } from '../src/lib/extract/spreadsheet.js'
import { MAX_ROWS } from '../src/lib/extract/extract.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

async function loadComponent(relPath) {
  const entry = join(repoRoot, relPath)
  const res = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'docx', 'exceljs', 'mammoth', 'xlsx', 'pdfjs-dist', '@anthropic-ai/sdk']
  })
  const tmp = join(repoRoot, `.render-test-${randomBytes(6).toString('hex')}.mjs`)
  await writeFile(tmp, res.outputFiles[0].text, 'utf8')
  try {
    return await import(pathToFileURL(tmp).href)
  } finally {
    await unlink(tmp).catch(() => {})
  }
}

function fileFromBytes(u8, name) {
  const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
  return { name, size: u8.byteLength, arrayBuffer: async () => ab }
}
function xlsxFile(grid, name = 'big.xlsx') {
  const ws = XLSX.utils.aoa_to_sheet(grid)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const u8 = out instanceof Uint8Array ? out : new Uint8Array(out)
  return fileFromBytes(u8, name)
}

// --- 1. Pure helper ---------------------------------------------------------

test('truncationNotices returns one notice per truncated extraction', () => {
  const items = [
    { fileName: 'big.csv', extracted: { metadata: { truncated: true, rowsRead: 501, totalRows: 12001 } } },
    { fileName: 'ok.csv', extracted: { metadata: { truncated: false, rowsRead: 40, totalRows: 40 } } },
    { fileName: 'pending.csv', status: 'pending' }, // no extracted yet
    { fileName: 'failed.csv', extracted: { text: [], tables: [], metadata: {} } }
  ]
  assert.deepEqual(truncationNotices(items), [
    { fileName: 'big.csv', rowsRead: 501, totalRows: 12001 }
  ])
})

test('truncationNotices ignores a truncated flag with unusable counts', () => {
  const items = [{ fileName: 'x.csv', extracted: { metadata: { truncated: true } } }]
  assert.deepEqual(truncationNotices(items), [])
})

test('truncationNotices is empty for empty / non-array input', () => {
  assert.deepEqual(truncationNotices([]), [])
  assert.deepEqual(truncationNotices(undefined), [])
})

// --- 2. Both caps set metadata.truncated ------------------------------------

test('a 12,000-row flat file trips the MAX_ROWS cap and flags truncated', async () => {
  const grid = [['Account', 'Actual', 'Budget']]
  for (let i = 0; i < 12000; i++) {
    if (i === 800) grid.push(['BIG LEAK', '500000', '100000']) // planted past row 500
    else grid.push([`Acct ${i}`, String(i), String(i)])
  }
  const ex = await extractSpreadsheet(xlsxFile(grid), MAX_ROWS)
  assert.equal(ex.metadata.truncated, true)
  assert.equal(ex.metadata.rowsRead, MAX_ROWS + 1) // + header
  assert.equal(ex.metadata.totalRows, 12001)
  assert.deepEqual(truncationNotices([{ fileName: 'big.xlsx', extracted: ex }]), [
    { fileName: 'big.xlsx', rowsRead: MAX_ROWS + 1, totalRows: 12001 }
  ])
})

test('an account-sectioned GL past SECTIONED_GL_MAX_ROWS also flags truncated', async () => {
  // A section header (Balance Forward marker in col 9, account name in col 3)
  // opens the section; thousands of dated transaction rows follow.
  const wide = (cells) => {
    const row = new Array(13).fill('')
    for (const [i, v] of cells) row[i] = v
    return row
  }
  const grid = [wide([[3, 'Rent Income'], [9, 'Balance Forward']])]
  for (let i = 0; i < SECTIONED_GL_MAX_ROWS + 500; i++) {
    grid.push(wide([[3, '01/15/2026'], [5, `REF${i}`], [9, 'entry'], [10, '100'], [12, '100']]))
  }
  const ex = await extractSpreadsheet(xlsxFile(grid, 'gl.xlsx'), MAX_ROWS)
  assert.equal(ex.metadata.truncated, true)
  assert.equal(ex.metadata.rowsRead, SECTIONED_GL_MAX_ROWS)
  assert.ok(ex.metadata.totalRows > SECTIONED_GL_MAX_ROWS)
})

// --- 3. The component actually renders the warning --------------------------

test('TruncationNotice renders a visible alert naming the file and row counts', async () => {
  const { default: TruncationNotice } = await loadComponent('src/components/TruncationNotice.jsx')
  const items = [{ fileName: 'big.csv', extracted: { metadata: { truncated: true, rowsRead: 501, totalRows: 12001 } } }]
  const html = renderToStaticMarkup(React.createElement(TruncationNotice, { items }))
  assert.match(html, /role="alert"/)
  assert.match(html, /Some rows were not processed/)
  assert.match(html, /big\.csv/)
  assert.match(html, /501/)
  assert.match(html, /12,001/) // toLocaleString grouping
  assert.match(html, /some variances may be missing/i)
})

test('TruncationNotice renders nothing when no file was truncated', async () => {
  const { default: TruncationNotice } = await loadComponent('src/components/TruncationNotice.jsx')
  const items = [{ fileName: 'ok.csv', extracted: { metadata: { truncated: false, rowsRead: 20, totalRows: 20 } } }]
  const html = renderToStaticMarkup(React.createElement(TruncationNotice, { items }))
  assert.equal(html, '')
})
