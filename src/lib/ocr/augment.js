// --- OCR augmentation of an unreadable-PDF extraction (browser) -------------
// Bridges the OCR path into the existing extraction shape: when a PDF has no
// usable text layer — an image-only scan, OR a present-but-garbled layer from a
// broken font/encoding (metadata.scanned set in pdf.js) — render + OCR it and
// rebuild the extraction via the SAME normalizer the text/position parsers use,
// so the rest of the pipeline (variance, evidence index, enrichment) is
// unchanged.
//
// The base report is a comparative income statement → OCR'd into the variance
// table. Supporting files are General Ledgers → OCR'd into the typed GL table.
//
// On any failure the original extraction is returned unchanged, so a file we
// can't read behaves exactly as before — no error surfaced.

import { normalize } from '../extract/normalize.js'
import { ocrExtractTable, ocrExtractIncomeStatement } from './ocrClient.js'

// A PDF pdf.js could not read as usable text (image-only scan or garbled font /
// encoding), flagged by the metadata set in pdf.js.
export function isScannedPdf(result) {
  return !!(result && result.extracted && result.extracted.metadata && result.extracted.metadata.scanned)
}

// Rebuild an extraction result from an OCR-recovered table, re-running the SAME
// normalizer the text/position parsers use so downstream stays identical. When
// `classification` is given it overrides the type (a recovered GL is GL evidence
// regardless of file name); otherwise the original classification is kept.
function withOcrTable(result, table, classification) {
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
    classification: classification || result.classification,
    extracted,
    normalized,
    confidence
  }
}

// Returns a possibly-augmented extraction result. `role` distinguishes the base
// report (a comparative income statement) from supporting files (GLs).
export async function augmentWithOcr(result, file, { role } = {}) {
  // OCR engages only when the text layer is unusable. A file that parsed cleanly
  // is returned untouched, so its behavior is exactly as before.
  if (!isScannedPdf(result)) return result

  if (role === 'baseReport') {
    // Income statement → variance table; keep its Base Variance Report type.
    const table = await ocrExtractIncomeStatement(file)
    if (!table) return result // silent: keep the original (empty) result
    return withOcrTable(result, table)
  }

  // Supporting General Ledger → typed GL table.
  const table = await ocrExtractTable(file)
  if (!table) return result // silent: keep the original (empty) result
  return withOcrTable(result, table, { ...(result.classification || {}), type: 'General Ledger (GL)' })
}
