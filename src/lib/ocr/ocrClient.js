// --- OCR client orchestration (browser) -----------------------------------
// For a scanned PDF: render its pages and ask the server (/api/ocr) to run
// Claude vision over them, returning the same typed GL table the deterministic
// reconstructors emit. Any failure resolves to null, so the caller keeps the
// original "scanned, no text" extraction and nothing is surfaced to the user.
//
// pdf.js is imported lazily (dynamic import of renderPdf.js) so it never enters
// the initial bundle.

import { accountsToTable, rowsToTable } from './ocrTable.js'

// Abort a stalled /api/ocr call after this long, so a dead endpoint can never
// leave the file stuck at `pending` — the timeout resolves to the same silent
// empty result as every other OCR failure.
const OCR_FETCH_TIMEOUT_MS = 90000

// The hosting platform rejects request bodies over ~4.5 MB before the handler
// runs, so page images are posted in sequential batches under this budget and
// the responses merged. Data-URL length ≈ payload bytes (base64 is ASCII).
const MAX_BATCH_BYTES = 3.5 * 1024 * 1024

// Split the page images into ordered batches whose combined payload stays under
// MAX_BATCH_BYTES. A single oversized page still ships alone — the server's own
// body cap is the final guard.
function batchImages(images) {
  const batches = []
  let batch = []
  let size = 0
  for (const img of images) {
    const bytes = String(img).length
    if (batch.length > 0 && size + bytes > MAX_BATCH_BYTES) {
      batches.push(batch)
      batch = []
      size = 0
    }
    batch.push(img)
    size += bytes
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}

// POST one batch of images. Returns the parsed response body, or null on any
// failure (network error, timeout, non-JSON, success !== true).
async function postOcrBatch(images, fileName, mode) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OCR_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images, fileName, mode }),
      signal: controller.signal
    })
    const data = await res.json().catch(() => null)
    if (!data || data.success !== true) return null
    return data
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Merge per-batch GL accounts. An account section that spans a batch boundary
// comes back once per batch, so accounts with the same (whitespace-normalized)
// label combine their transactions; first-seen order is kept.
function mergeAccounts(batches) {
  const byLabel = new Map()
  const merged = []
  for (const accounts of batches) {
    for (const acct of Array.isArray(accounts) ? accounts : []) {
      if (!acct || typeof acct !== 'object') continue
      const label = String(acct.account || '')
        .replace(/\s+/g, ' ')
        .trim()
      const txns = Array.isArray(acct.transactions) ? acct.transactions : []
      const existing = byLabel.get(label)
      if (existing) {
        existing.transactions.push(...txns)
      } else {
        const entry = { account: acct.account, transactions: [...txns] }
        byLabel.set(label, entry)
        merged.push(entry)
      }
    }
  }
  return merged
}

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
    const fileName = (file && file.name) || ''
    // Sequential batched posts, merged into one result. A failed batch fails the
    // whole extraction (null) — a partially-transcribed ledger would feed the
    // evidence engine misleading totals, so it's all pages or nothing.
    const accountBatches = []
    const mergedRows = []
    for (const batch of batchImages(images)) {
      const data = await postOcrBatch(batch, fileName, mode)
      if (!data) return null
      if (mode === 'incomeStatement') mergedRows.push(...(Array.isArray(data.rows) ? data.rows : []))
      else accountBatches.push(data.accounts)
    }
    return mode === 'incomeStatement' ? rowsToTable(mergedRows) : accountsToTable(mergeAccounts(accountBatches))
  } catch (err) {
    return null
  }
}
