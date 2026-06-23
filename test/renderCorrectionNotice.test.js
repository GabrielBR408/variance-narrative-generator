// Render-proof tests for the generate-time role-correction notice (Option A).
// Mirrors renderEnrichmentStatus.test.js: bundle the real JSX with esbuild and
// server-render it, and read back a real XLSX, so a regression where the notice
// stops reaching the DOM / export fails CI.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, unlink } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as esbuild from 'esbuild'
import ExcelJS from 'exceljs'

import { narrativeToExcelBuffer, OWNER_SHEET } from '../src/lib/export/excel.js'

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

const NOTICE =
  'We detected your files were assigned different roles than uploaded — we’ve adjusted automatically. ' +
  'Base report: Income Statement.pdf. Supporting: GL Worksheet (1).pdf. Generating now.'

function narrativeStub() {
  return {
    fileName: 'Income Statement.pdf',
    classification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    periods: [
      {
        period: 'current', periodLabel: 'Current', executiveSummary: [],
        highVariances: [{ account: 'Utilities Expense', varianceAmount: 10000, text: 'Utilities Expense over budget by $10,000.', sourceRows: [0] }],
        missingData: [], revenueNotes: [], expenseNotes: [], sourceRows: []
      }
    ]
  }
}

// --- 1. The notice component renders the text -------------------------------

test('CorrectionNotice renders the swap notice when a correction occurred', async () => {
  const { default: CorrectionNotice } = await loadComponent('src/components/CorrectionNotice.jsx')
  const html = renderToStaticMarkup(React.createElement(CorrectionNotice, { correction: { notice: NOTICE } }))
  assert.match(html, /adjusted automatically/)
  assert.match(html, /Base report: Income Statement\.pdf/)
})

test('CorrectionNotice renders nothing when there is no correction', async () => {
  const { default: CorrectionNotice } = await loadComponent('src/components/CorrectionNotice.jsx')
  assert.equal(renderToStaticMarkup(React.createElement(CorrectionNotice, { correction: null })), '')
})

// --- 2. The notice is wired into the rendered ResultPanel -------------------

test('ResultPanel renders the correction notice for a successful, corrected result', async () => {
  const { default: ResultPanel } = await loadComponent('src/components/ResultPanel.jsx')
  const narrative = narrativeStub()
  const result = {
    jobId: 'JOB-1', filesReceived: 2, settingsReceived: true, files: [], extraction: {}, variance: {},
    narrative, enrichment: null, correction: { notice: NOTICE }
  }
  const html = renderToStaticMarkup(React.createElement(ResultPanel, { status: 'success', result }))
  assert.match(html, /adjusted automatically/)
})

// --- 3. The notice is in the actual XLSX output -----------------------------

test('XLSX "File Roles" header carries the correction notice', async () => {
  const buf = await narrativeToExcelBuffer(narrativeStub(), {
    generatedDate: new Date('2026-06-23T00:00:00Z'),
    correction: { notice: NOTICE }
  })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const owner = wb.getWorksheet(OWNER_SHEET)
  let found = null
  owner.eachRow((row) => {
    if (String(row.getCell(1).value) === 'File Roles') found = row.getCell(2).value
  })
  assert.ok(found, 'File Roles row present')
  assert.match(String(found), /adjusted automatically/)
})
