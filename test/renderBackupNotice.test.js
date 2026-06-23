// Render-proof tests for the insufficient-backup notice.
//
// Mirrors renderEnrichmentStatus.test.js: logic-only tests can pass while the
// value never reaches the DOM, so these render the ACTUAL components (via
// react-dom/server) — bundling the real .jsx with esbuild into a temp ESM
// module — so a regression where the notice stops rendering fails CI.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, unlink } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as esbuild from 'esbuild'

import { backupNotice, BUDGET_RECOMMENDATION, GL_RECOMMENDATION } from '../src/lib/backupNotice.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

// Bundle a real .jsx component (and its local import graph) into a temp ESM
// module, import it, and return its exports. npm deps stay external so the same
// React instance is used. (Identical to renderEnrichmentStatus.test.js.)
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

// A realistic generated narrative (budget-based, GL-supported) for the panel.
function baseResult(overrides = {}) {
  const narrative = {
    fileName: 'income-statement.xlsx',
    periods: [{
      period: 'current', periodLabel: 'Current',
      highVariances: [{ account: 'Repairs', varianceAmount: -8500, text: 'Repairs exceeded budget by $8,500.', comparisonType: 'budget', sourceRows: [0] }],
      missingData: [], revenueNotes: [], expenseNotes: [], sourceRows: []
    }]
  }
  return {
    jobId: 'JOB-1', filesReceived: 1, settingsReceived: true,
    files: [], extraction: {}, variance: { columns: { account: 0, actual: 1, budget: 2, prior: null } },
    narrative, enrichment: null, ...overrides
  }
}

// --- leaf component ---------------------------------------------------------

test('BackupNotice renders each recommendation line', async () => {
  const { default: BackupNotice } = await loadComponent('src/components/BackupNotice.jsx')
  const notice = { recommendations: [BUDGET_RECOMMENDATION, GL_RECOMMENDATION] }
  const html = renderToStaticMarkup(React.createElement(BackupNotice, { notice }))
  assert.match(html, /Your backup was limited/)
  assert.match(html, /Add a detailed budget to compare actuals against plan\./)
  assert.match(html, /Add a year-to-date GL so commentary can cite specific entries\./)
})

test('BackupNotice renders nothing when there is no notice', async () => {
  const { default: BackupNotice } = await loadComponent('src/components/BackupNotice.jsx')
  const html = renderToStaticMarkup(React.createElement(BackupNotice, { notice: null }))
  assert.equal(html, '')
})

// --- integration: wired into ResultPanel -----------------------------------

test('ResultPanel shows the budget recommendation when no budget basis', async () => {
  const { default: ResultPanel } = await loadComponent('src/components/ResultPanel.jsx')
  // Prior-only variance, no GL file → both recommendations.
  const result = baseResult({ variance: { columns: { account: 0, actual: 1, budget: null, prior: 2 } } })
  result.backup = backupNotice({ narrative: null, variance: result.variance, files: result.files })
  const html = renderToStaticMarkup(React.createElement(ResultPanel, { status: 'success', result }))
  assert.match(html, /Add a detailed budget to compare actuals against plan\./)
})

test('ResultPanel shows the GL recommendation when no GL file is present', async () => {
  const { default: ResultPanel } = await loadComponent('src/components/ResultPanel.jsx')
  const result = baseResult({ files: [{ name: 'income-statement.xlsx', role: 'baseReport' }] })
  result.backup = backupNotice({ narrative: result.narrative, variance: result.variance, files: result.files })
  const html = renderToStaticMarkup(React.createElement(ResultPanel, { status: 'success', result }))
  assert.match(html, /Add a year-to-date GL so commentary can cite specific entries\./)
})

test('ResultPanel shows NO backup notice when every needed input is present', async () => {
  const { default: ResultPanel } = await loadComponent('src/components/ResultPanel.jsx')
  // Budget basis + a GL file present → null notice → nothing rendered.
  const result = baseResult({ files: [{ name: 'income-statement.xlsx', role: 'baseReport' }, { name: 'General Ledger.pdf', role: 'supportingFile' }] })
  result.backup = backupNotice({ narrative: result.narrative, variance: result.variance, files: result.files })
  const html = renderToStaticMarkup(React.createElement(ResultPanel, { status: 'success', result }))
  assert.doesNotMatch(html, /Your backup was limited/)
  assert.doesNotMatch(html, /Add a detailed budget/)
  assert.doesNotMatch(html, /Add a year-to-date GL/)
})

test('ResultPanel combines multiple missing inputs into ONE notice', async () => {
  const { default: ResultPanel } = await loadComponent('src/components/ResultPanel.jsx')
  const result = baseResult({
    variance: { columns: { account: 0, actual: 1, budget: null, prior: 2 } },
    files: [{ name: 'income-statement.xlsx', role: 'baseReport' }]
  })
  result.backup = backupNotice({ narrative: null, variance: result.variance, files: result.files })
  const html = renderToStaticMarkup(React.createElement(ResultPanel, { status: 'success', result }))
  // Exactly one notice container carrying both lines.
  assert.equal((html.match(/Your backup was limited/g) || []).length, 1)
  assert.match(html, /Add a detailed budget to compare actuals against plan\./)
  assert.match(html, /Add a year-to-date GL so commentary can cite specific entries\./)
})
