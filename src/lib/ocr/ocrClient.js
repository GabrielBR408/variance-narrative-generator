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
    console.log('[OCR] ocrExtractTable triggered — mode:', mode, 'file:', file && file.name)
    const { renderPdfToImages } = await import('./renderPdf.js')
    const images = await renderPdfToImages(file, { maxPages })
    console.log('[OCR] images rendered:', images ? images.length : 0)
    if (!images || images.length === 0) {
      console.log('[OCR] no images — aborting')
      return null
    }
    const res = await fetch('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images, fileName: (file && file.name) || '', mode })
    })
    console.log('[OCR] server response status:', res.status)
    const data = await res.json().catch(() => null)
    console.log('[OCR] server response data keys:', data ? Object.keys(data) : null, 'success:', data && data.success, 'rows:', data && data.rows && data.rows.length, 'accounts:', data && data.accounts && data.accounts.length)
    if (!data || data.success !== true) {
      console.log('[OCR] bad response — returning null')
      return null
    }
    const table = mode === 'incomeStatement' ? rowsToTable(data.rows) : accountsToTable(data.accounts)
    console.log('[OCR] table result:', table ? 'OK (' + (table.rows && table.rows.length) + ' rows)' : 'null')
    return table
  } catch (err) {
    console.error('[OCR] caught error:', err)
    return null
  }
}
