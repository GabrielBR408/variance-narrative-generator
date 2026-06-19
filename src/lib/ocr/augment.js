// --- OCR augmentation of an unusable-text PDF extraction (browser) ----------
// Bridges the OCR path into the existing extraction shape. Two cases reach OCR:
//   • a SUPPORTING PDF that extracted as "scanned" (image-only, no text layer):
//     render + OCR it as a General Ledger and rebuild the extraction from the
//     recovered GL table;
//   • the BASE income statement whose text layer is "garbled" (a non-standard
//     font/encoding decoded to unreadable glyphs, so no table reconstructed):
//     render + OCR it as a comparative income statement and rebuild from the
//     recovered variance table.
// Both rebuild via the SAME normalizer the text / position parsers use, so the
// rest of the pipeline (variance engine, evidence index, enrichment, LLM
// packets) is unchanged.
//
// On any failure the original extraction is returned unchanged, so a page we
// can't read behaves exactly as before — no error surfaced.

import { normalize } from '../extract/normalize.js'
import { ocrExtractTable } from './ocrClient.js'

// A PDF that pdf.js read as pages-but-no-text (the metadata flag set in pdf.js).
export function isScannedPdf(result) {
  return !!(result && result.extracted && result.extracted.metadata && result.extracted.metadata.scanned)
}

// A PDF that DID yield text but whose figures didn't survive a non-standard
// font/encoding, so no table could be reconstructed (flag set in pdf.js).
export function isGarbledPdf(result) {
  return !!(result && result.extracted && result.extracted.metadata && result.extracted.metadata.garbled)
}

// Returns a possibly-augmented extraction result. `role` distinguishes the base
// report (OCR'd as an income statement, only when its text is garbled) from
// supporting files (OCR'd as a General Ledger, only when scanned).
export async function augmentWithOcr(result, file, { role } = {}) {
  // The base income statement reaches OCR only when its text layer is unusable
  // (garbled). A base report that already parsed is returned unchanged.
  if (role === 'baseReport') {
    console.log('[OCR] augmentWithOcr — baseReport — scanned:', isScannedPdf(result), 'garbled:', isGarbledPdf(result))
    if (!isGarbledPdf(result) && !isScannedPdf(result)) return result
    const table = await ocrExtractTable(file, { mode: 'incomeStatement' })
    if (!table) return result // silent: keep the original (unusable) result
    const extracted = {
      text: [],
      tables: [table],
      metadata: { ...(result.extracted && result.extracted.metadata), ocr: true }
    }
    const { normalized, confidence } = normalize(extracted, 'pdf')
    return { ...result, status: 'ok', message: '', extracted, normalized, confidence }
  }

  // Supporting files: a scanned (image-only) PDF GL.
  if (!isScannedPdf(result)) return result

  const table = await ocrExtractTable(file)
  if (!table) return result // silent: keep the original scanned (empty) result

  const extracted = {
    text: [],
    tables: [table],
    metadata: { ...(result.extracted && result.extracted.metadata), ocr: true }
  }
  const { normalized, confidence } = normalize(extracted, 'pdf')
  return {
    ...result,
    status: 'ok',
    message: '',
    // A recovered GL is GL evidence regardless of the file name.
    classification: { ...(result.classification || {}), type: 'General Ledger (GL)' },
    extracted,
    normalized,
    confidence
  }
}
