// --- OCR client orchestration (browser) -----------------------------------
// For a scanned PDF: render its pages and ask the server (/api/ocr) to run
// Claude vision over them, returning the same typed GL table the deterministic
// reconstructors emit. Any failure resolves to null, so the caller keeps the
// original "scanned, no text" extraction and nothing is surfaced to the user.
//
// pdf.js is imported lazily (dynamic import of renderPdf.js) so it never enters
// the initial bundle.

import { accountsToTable } from './ocrTable.js'

export async function ocrExtractTable(file, { maxPages = 12 } = {}) {
  try {
    const { renderPdfToImages } = await import('./renderPdf.js')
    const images = await renderPdfToImages(file, { maxPages })
    if (!images || images.length === 0) return null

    const res = await fetch('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images, fileName: (file && file.name) || '' })
    })
    const data = await res.json().catch(() => null)
    if (!data || data.success !== true) return null
    return accountsToTable(data.accounts)
  } catch {
    return null
  }
}
