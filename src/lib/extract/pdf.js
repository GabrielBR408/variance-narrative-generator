// --- PDF parser — Phase 7 -------------------------------------------------
// Extracts plain text from a PDF, page by page, using pdf.js. Text ONLY:
// there is deliberately no OCR, so image-only / scanned PDFs return no text
// (the normalizer reports that as low/zero confidence).
//
// Capped at MAX_PAGES so a huge document can't spike memory or time. Errors are
// thrown with a `reason` the orchestrator maps to a friendly message; the raw
// pdf.js error is never surfaced.

import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

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

  try {
    for (let i = 1; i <= pagesToRead; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const line = content.items
        .map((item) => (item && typeof item.str === 'string' ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (line) text.push(line)
      page.cleanup()
    }
  } catch {
    throw fail('structure')
  } finally {
    // Release the document; nothing is kept between calls.
    doc.destroy?.()
  }

  return {
    text,
    tables: [],
    metadata: {
      pages: totalPages,
      pagesRead: pagesToRead,
      truncated: totalPages > pagesToRead,
      scanned: totalPages > 0 && text.length === 0 // text-free PDF ⇒ likely scanned
    }
  }
}
