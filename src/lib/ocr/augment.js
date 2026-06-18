// --- OCR augmentation of a scanned-PDF extraction (browser) ----------------
// Bridges the OCR path into the existing extraction shape: when a SUPPORTING PDF
// extracted as "scanned" (image-only, no text layer), render + OCR it and
// rebuild the extraction from the recovered GL table via the SAME normalizer the
// text / position parsers use — so the rest of the pipeline (evidence index,
// enrichment, LLM packets) is unchanged.
//
// On any failure the original (empty) extraction is returned unchanged, so a
// scan we can't read behaves exactly as before — no error surfaced.

import { normalize } from '../extract/normalize.js'
import { ocrExtractTable } from './ocrClient.js'

// A PDF that pdf.js read as pages-but-no-text (the metadata flag set in pdf.js).
export function isScannedPdf(result) {
  return !!(result && result.extracted && result.extracted.metadata && result.extracted.metadata.scanned)
}

// Returns a possibly-augmented extraction result. `role` distinguishes the base
// report (never OCR'd here) from supporting files.
export async function augmentWithOcr(result, file, { role } = {}) {
  if (role === 'baseReport') return result // scope: supporting files only
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
