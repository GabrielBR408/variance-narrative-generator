// --- PDF parser — Phase 7 (+ 7.1 table reconstruction) --------------------
// Extracts plain text from a PDF, page by page, using pdf.js. Text ONLY:
// there is deliberately no OCR, so image-only / scanned PDFs return no text
// (the normalizer reports that as low/zero confidence).
//
// Phase 7.1: the text items are also grouped into visual lines (via pdf.js's
// per-item end-of-line marker), and those lines are handed to a deterministic
// regex reconstructor that rebuilds variance-report rows into a normalized
// table. `text` still carries the per-page strings exactly as before.
//
// Capped at MAX_PAGES so a huge document can't spike memory or time. Errors are
// thrown with a `reason` the orchestrator maps to a friendly message; the raw
// pdf.js error is never surfaced.

import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { reconstructTable } from './pdfTable.js'

// Run the parser in pdf.js's own worker (this is part of the library, not an
// app-level background job). Configured once at module load.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

function fail(reason, message) {
  return Object.assign(new Error(message || reason), { reason })
}

export async function extractPdf(file, maxPages) {
  const data = new Uint8Array(await file.arrayBuffer())

  let doc
  try {
    doc = await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      disableFontFace: true
    }).promise
  } catch (err) {
    if (err && (err.name === 'PasswordException' || /password/i.test(err.message || ''))) {
      throw fail('password')
    }
    throw fail('corrupt')
  }

  const totalPages = doc.numPages || 0
  const pagesToRead = Math.min(totalPages, maxPages)
  const text = []
  const lines = [] // visual lines across all pages, for table reconstruction

  try {
    for (let i = 1; i <= pagesToRead; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()

      // Group text items into visual lines using pdf.js's end-of-line marker.
      // Items within a line are space-joined (matching the previous behavior),
      // so a number like "29,522.70" stays one token and adjacent cells stay
      // separated.
      let current = []
      for (const item of content.items) {
        const str = item && typeof item.str === 'string' ? item.str : ''
        if (str) current.push(str)
        if (item && item.hasEOL) {
          const line = current.join(' ').replace(/\s+/g, ' ').trim()
          if (line) lines.push(line)
          current = []
        }
      }
      if (current.length) {
        const line = current.join(' ').replace(/\s+/g, ' ').trim()
        if (line) lines.push(line)
      }

      // Per-page text string — same shape consumers already rely on.
      const pageText = content.items
        .map((item) => (item && typeof item.str === 'string' ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (pageText) text.push(pageText)

      page.cleanup()
    }
  } catch {
    throw fail('structure')
  } finally {
    // Release the document; nothing is kept between calls.
    doc.destroy?.()
  }

  // Reconstruct a variance table from the grouped lines (deterministic regex
  // only). Null when the text doesn't look tabular.
  const table = reconstructTable(lines)
  const tables = table ? [table] : []

  return {
    text,
    tables,
    metadata: {
      pages: totalPages,
      pagesRead: pagesToRead,
      truncated: totalPages > pagesToRead,
      scanned: totalPages > 0 && text.length === 0, // text-free PDF ⇒ likely scanned
      tableReconstructed: tables.length > 0,
      tableSections: table ? table.sections : []
    }
  }
}
