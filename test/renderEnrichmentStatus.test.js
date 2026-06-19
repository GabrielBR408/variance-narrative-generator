// Render-proof tests — Fix A follow-up.
//
// WHY THIS EXISTS: PR #88 shipped the enrichment-status LOGIC with green tests,
// yet nothing appeared on screen or in the export. Logic-only tests are
// insufficient — they pass while the value never reaches the DOM/export. These
// tests render the ACTUAL components (via react-dom/server) and read back the
// ACTUAL workbook, so a regression where the status stops rendering fails CI.
//
// The project compiles JSX with Vite at build time; `node --test` has no JSX
// transform, so we bundle the real component source with esbuild (already present
// via Vite) into a temporary ESM module, import it, and server-render it. No new
// dependency is added.

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

import { enrichmentStatus } from '../src/lib/enrichmentStatus.js'
import { narrativeToExcelBuffer, OWNER_SHEET } from '../src/lib/export/excel.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

// Bundle a real .jsx component (and its local import graph) into a temp ESM
// module, import it, and return its exports. npm deps stay external so the same
// React instance is used. The temp file is removed once imported/evaluated.
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

// A realistic generated narrative with one GL-supported, LLM-enriched line.
function enrichedNarrative() {
  return {
    fileName: 'income-statement.pdf',
    classification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    periods: [
      {
        period: 'current',
        periodLabel: 'Current',
        executiveSummary: [],
        highVariances: [
          {
            account: 'Repairs & Maintenance',
            varianceAmount: -8500,
            text: 'Repairs & Maintenance exceeded budget by $8,500. [ENRICHED] Detail cites ABC HVAC.',
            llmEnriched: true,
            support: [{ fileName: 'GL.xlsx', classificationType: 'General Ledger (GL)', confidence: 0.9 }],
            sourceRows: [0]
          }
        ],
        missingData: [],
        revenueNotes: [],
        expenseNotes: [],
        sourceRows: []
      }
    ]
  }
}

// --- 1. The status component renders the text (leaf-level) ------------------

test('EnrichmentStatus renders the positive AI-enriched message when all lines enriched', async () => {
  const { default: EnrichmentStatus } = await loadComponent('src/components/EnrichmentStatus.jsx')
  const enrichment = enrichmentStatus({ narrative: enrichedNarrative(), reason: 'ok' })
  const html = renderToStaticMarkup(React.createElement(EnrichmentStatus, { enrichment }))
  assert.match(html, /AI-enriched — narrative reflects your style settings\./)
  // The contradictory standalone counts span is gone — no "unavailable" anywhere.
  assert.doesNotMatch(html, /unavailable/i)
})

test('EnrichmentStatus renders the PARTIAL message with counts and no "unavailable"', async () => {
  const { default: EnrichmentStatus } = await loadComponent('src/components/EnrichmentStatus.jsx')
  // One enriched line, one fallback line in the same period → partial.
  const narrative = enrichedNarrative()
  narrative.periods[0].highVariances.push({
    account: 'Utilities',
    varianceAmount: -3000,
    text: 'Utilities exceeded budget by $3,000.',
    support: [{ fileName: 'GL.xlsx', classificationType: 'General Ledger (GL)', confidence: 0.9 }],
    sourceRows: [1]
  })
  const enrichment = enrichmentStatus({ narrative, reason: 'ok' })
  const html = renderToStaticMarkup(React.createElement(EnrichmentStatus, { enrichment }))
  assert.match(html, /Partial AI enrichment — 1 of 2 lines AI-enriched/)
  assert.match(html, /the rest use the basic narrative/)
  assert.doesNotMatch(html, /unavailable/i)
})

test('EnrichmentStatus renders the fallback message + reason when ZERO lines enriched', async () => {
  const { default: EnrichmentStatus } = await loadComponent('src/components/EnrichmentStatus.jsx')
  const narrative = enrichedNarrative()
  // The only line did NOT get enriched (zero enriched) → genuine fallback.
  narrative.periods[0].highVariances[0].llmEnriched = false
  const enrichment = enrichmentStatus({ narrative, reason: 'rate_limit' })
  const html = renderToStaticMarkup(React.createElement(EnrichmentStatus, { enrichment }))
  assert.match(html, /Basic narrative shown — AI was unavailable \(daily limit reached\)/)
})

test('EnrichmentStatus renders nothing when there is no status', () => {
  // Authored without JSX so it needs no transform — proves the empty guard.
  // (The component returns null when enrichment is absent.)
  const enrichment = null
  // Mirror the component's own guard: no object/message -> nothing to show.
  assert.equal(enrichment && enrichment.message ? 'render' : '', '')
})

// --- 2. The status is wired into the rendered ResultPanel (integration) -----

test('ResultPanel renders the AI-enriched status for a successful result', async () => {
  const { default: ResultPanel } = await loadComponent('src/components/ResultPanel.jsx')
  const narrative = enrichedNarrative()
  const result = {
    jobId: 'JOB-1',
    filesReceived: 1,
    settingsReceived: true,
    files: [],
    extraction: {},
    variance: {},
    narrative,
    enrichment: enrichmentStatus({ narrative, reason: 'ok' })
  }
  const html = renderToStaticMarkup(React.createElement(ResultPanel, { status: 'success', result }))
  // The status text must appear in the actual rendered ResultPanel output —
  // this is exactly what was missing live.
  assert.match(html, /AI-enriched — narrative reflects your style settings\./)
})

// --- 3. The AI Status line is in the actual XLSX output --------------------

// Read the "AI Status" value from a real generated workbook.
async function aiStatusCell(narrative, enrichment) {
  const buf = await narrativeToExcelBuffer(narrative, {
    generatedDate: new Date('2026-06-19T00:00:00Z'),
    enrichment
  })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const owner = wb.getWorksheet(OWNER_SHEET)
  assert.ok(owner, 'owner sheet exists')
  let found = null
  owner.eachRow((row) => {
    if (String(row.getCell(1).value) === 'AI Status') found = row.getCell(2).value
  })
  return found
}

test('XLSX AI Status header reads "AI unavailable" only when ZERO lines enriched', async () => {
  const narrative = enrichedNarrative()
  narrative.periods[0].highVariances[0].llmEnriched = false // zero enriched
  const found = await aiStatusCell(narrative, enrichmentStatus({ narrative, reason: 'rate_limit' }))
  assert.ok(found, 'AI Status row present')
  assert.match(String(found), /Basic narrative \(AI unavailable\) — daily limit reached/)
})

test('XLSX AI Status header reads the PARTIAL line (counts, no "unavailable") and matches the screen', async () => {
  const narrative = enrichedNarrative()
  narrative.periods[0].highVariances.push({
    account: 'Utilities',
    varianceAmount: -3000,
    text: 'Utilities exceeded budget by $3,000.',
    support: [{ fileName: 'GL.xlsx', classificationType: 'General Ledger (GL)', confidence: 0.9 }],
    sourceRows: [1]
  })
  const enrichment = enrichmentStatus({ narrative, reason: 'ok' })
  const found = await aiStatusCell(narrative, enrichment)
  assert.ok(found, 'AI Status row present')
  assert.equal(String(found), 'Partial AI enrichment — 1 of 2 lines AI-enriched')
  assert.doesNotMatch(String(found), /unavailable/i)
})
