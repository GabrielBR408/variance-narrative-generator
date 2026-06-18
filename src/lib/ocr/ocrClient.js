// --- OCR client orchestration (browser) -----------------------------------
// For a scanned PDF: render its pages and ask the server (/api/ocr) to run
// Claude vision over them, returning the same typed GL table the deterministic
// reconstructors emit. Any failure resolves to null, so the caller keeps the
// original "scanned, no text" extraction and nothing is surfaced to the user.
//
// pdf.js is imported lazily (dynamic import of renderPdf.js) so it never enters
// the initial bundle.

import { accountsToTable } from './ocrTable.js'
import { incomeStatementToTable } from './ocrIncomeStatement.js'

// Render a PDF's pages and POST them to /api/ocr for vision transcription.
// Returns the raw JSON response, or null on any failure (silent). `kind` selects
// the server prompt: 'gl' (a General Ledger) or 'incomeStatement'.
async function postOcr(file, { maxPages, kind }) {
  const { renderPdfToImages } = await import('./renderPdf.js')
  const images = await renderPdfToImages(file, { maxPages })
  if (!images || images.length === 0) return null

  const res = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, kind, fileName: (file && file.name) || '' })
  })
  const data = await res.json().catch(() => null)
  if (!data || data.success !== true) return null
  return data
}

// OCR a scanned/garbled General Ledger PDF into the typed GL table. Null on any
// failure, so the caller keeps the original extraction and nothing is surfaced.
export async function ocrExtractTable(file, { maxPages = 12 } = {}) {
  try {
    const data = await postOcr(file, { maxPages, kind: 'gl' })
    return data ? accountsToTable(data.accounts) : null
  } catch {
    return null
  }
}

// OCR a scanned/garbled comparative INCOME STATEMENT PDF into the variance
// table. Null on any failure, so the caller keeps the original extraction.
export async function ocrExtractIncomeStatement(file, { maxPages = 12 } = {}) {
  try {
    const data = await postOcr(file, { maxPages, kind: 'incomeStatement' })
    return data ? incomeStatementToTable(data.rows) : null
  } catch {
    return null
  }
}
