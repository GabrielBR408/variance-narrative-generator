// --- Scanned-PDF page rendering (browser) ---------------------------------
// Renders the first pages of a (likely scanned) PDF to JPEG data URLs via pdf.js
// + a DOM canvas, so the server-side vision OCR has images to read. Browser-only
// (uses document.createElement('canvas') and the pdf.js worker). Bounded by
// maxPages and a max edge length to keep payloads and token costs in check.
// JPEG (not PNG) because a scanned page compresses far better as JPEG, and the
// request body must stay under the hosting platform's payload limit.
//
// Loaded only on demand (dynamic import from ocrClient.js), so pdf.js stays out
// of the initial bundle — exactly like the text/position PDF parser.

import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export async function renderPdfToImages(file, { maxPages = 12, maxEdge = 1600 } = {}) {
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise
  const images = []
  try {
    const n = Math.min(doc.numPages || 0, maxPages)
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i)
      const base = page.getViewport({ scale: 1 })
      const longest = Math.max(base.width, base.height) || 1
      const scale = Math.min(2, maxEdge / longest) || 1
      const viewport = page.getViewport({ scale: scale > 0 ? scale : 1 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport }).promise
      // pdf.js paints a white page background, so JPEG's lack of alpha is safe.
      images.push(canvas.toDataURL('image/jpeg', 0.85))
      page.cleanup()
    }
  } finally {
    doc.destroy?.()
  }
  return images
}
