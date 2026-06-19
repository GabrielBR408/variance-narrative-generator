// --- OCR client orchestration (browser) -----------------------------------
// For a scanned PDF: render its pages and ask the server (/api/ocr) to run
// Claude vision over them, returning the same typed GL table the deterministic
// reconstructors emit. Any failure resolves to null, so the caller keeps the
// original "scanned, no text" extraction and nothing is surfaced to the user.
//
// pdf.js is imported lazily (dynamic import of renderPdf.js) so it never enters
// the initial bundle.

import { accountsToTable, rowsToTable } from './ocrTable.js'

// `mode` selects what the server transcribes and how the result is mapped:
//   'gl'              → General Ledger accounts/transactions → GL table (default)
//   'incomeStatement' → comparative P&L rows → normalized variance table
export async function ocrExtractTable(file, { maxPages = 12, mode = 'gl' } = {}) {
  try {
    const { renderPdfToImages } = await import('./renderPdf.js')
    const images = await renderPdfToImages(file, { maxPages })
    if (!images || images.length === 0) {
      return null
    }
    const res = await fetch('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images, fileName: (file && file.name) || '', mode })
    })
    const data = await res.json().catch(() => null)
    if (!data || data.success !== true) {
      return null
    }
    const table = mode === 'incomeStatement' ? rowsToTable(data.rows) : accountsToTable(data.accounts)
    return table
  } catch (err) {
    return null
  }
}
