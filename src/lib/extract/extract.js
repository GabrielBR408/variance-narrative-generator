// --- Extraction orchestrator — Phase 7 ------------------------------------
// Opens an uploaded file, routes it to the right parser by extension, applies
// hard caps (rows / pages) and a wall-clock timeout, then hands the raw result
// to the normalizer. The returned object is the single in-memory shape the rest
// of the app consumes.
//
// Boundaries (Phase 7): this layer ONLY reads + structures content. It performs
// NO variance math, NO threshold logic, NO narratives, NO model calls, NO
// export, and NO persistence. Extracted content lives in memory for the session
// and is never written to disk or logged.
//
// It never throws: every failure (corrupt, password, empty, unsupported,
// timeout, parser crash) is caught and reported as a friendly status so the UI
// can render a message instead of breaking.

import { classifyFile } from '../classify.js'
import { normalize } from './normalize.js'

// Parsers are loaded on demand (dynamic import) so the heavy PDF/spreadsheet/
// DOCX libraries stay out of the initial bundle and aren't precached — they
// load only when a matching file is actually opened.

// Display + processing caps. These bound memory and time; they are NOT storage
// limits (nothing is ever stored).
export const MAX_ROWS = 50
export const MAX_PAGES = 20
export const EXTRACTION_TIMEOUT_MS = 20000

// Extensions Phase 7 knows how to open, mapped to the parser "kind".
const KIND_BY_EXT = {
  pdf: 'pdf',
  xlsx: 'spreadsheet',
  xls: 'spreadsheet',
  csv: 'spreadsheet',
  docx: 'document'
}

export function extensionOf(name = '') {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isExtractable(name = '') {
  return Boolean(KIND_BY_EXT[extensionOf(name)])
}

// Friendly, content-free messages. We never surface raw parser errors.
const MESSAGES = {
  unsupported: 'Extraction unavailable for this file type.',
  empty: 'This file appears to be empty.',
  password: 'This file is password-protected and can’t be opened.',
  corrupt: 'This file looks corrupt or unreadable.',
  structure: 'This file’s structure isn’t supported for extraction.',
  timeout: 'Extraction took too long and was stopped.',
  error: 'Something went wrong while reading this file.'
}

const STATUS_FOR_REASON = { unsupported: 'unavailable', empty: 'empty' }

function failure(base, reason) {
  return {
    ...base,
    status: STATUS_FOR_REASON[reason] || 'error',
    reason,
    message: MESSAGES[reason] || MESSAGES.error,
    extracted: { text: [], tables: [], metadata: {} },
    normalized: { rows: [], columns: [], accounts: [], dates: [], values: [] },
    confidence: 0
  }
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { reason: 'timeout' })), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// Main entry. Always resolves — never rejects.
// classification is optional; if omitted we compute it from the file name.
export async function extractFile({ file, fileId, classification } = {}) {
  const fileName = file?.name || 'file'
  const klass = classification || classifyFile({ name: fileName })
  const base = { fileId: fileId || fileName, fileName, classification: klass }

  const kind = KIND_BY_EXT[extensionOf(fileName)]
  if (!kind) return failure(base, 'unsupported')
  if (!file || file.size === 0) return failure(base, 'empty')

  try {
    let extracted
    if (kind === 'pdf') {
      const { extractPdf } = await import('./pdf.js')
      extracted = await withTimeout(extractPdf(file, MAX_PAGES, klass), EXTRACTION_TIMEOUT_MS)
    } else if (kind === 'spreadsheet') {
      const { extractSpreadsheet } = await import('./spreadsheet.js')
      extracted = await withTimeout(extractSpreadsheet(file, MAX_ROWS), EXTRACTION_TIMEOUT_MS)
    } else {
      const { extractDocument } = await import('./document.js')
      extracted = await withTimeout(extractDocument(file, MAX_ROWS), EXTRACTION_TIMEOUT_MS)
    }

    const { normalized, confidence, empty } = normalize(extracted, kind, MAX_ROWS)
    return {
      ...base,
      status: empty ? 'empty' : 'ok',
      message: empty ? 'No readable content was found in this file.' : '',
      extracted,
      normalized,
      confidence
    }
  } catch (err) {
    const reason = (err && err.reason) || 'error'
    return failure(base, MESSAGES[reason] ? reason : 'error')
  }
}
