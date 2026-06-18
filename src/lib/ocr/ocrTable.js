// --- OCR table mapping — vision JSON → GL table (pure) ---------------------
// Maps the Claude-vision OCR result for a scanned PDF General Ledger into the
// SAME typed table the deterministic GL reconstructors emit (GL_COLUMNS), so the
// OCR path joins the existing normalize → evidence-index → enrichment pipeline
// with ZERO downstream changes. Pure & deterministic: NO network, NO browser,
// NO model call — the page rendering and the vision call live in their own
// modules (renderPdf.js / ocrClient.js / server/ocr.js).

import { GL_COLUMNS } from '../extract/pdfTable.js'

// Coerce a vision amount — a number or numeric string, with debit-positive /
// credit-negative sign ALREADY applied by the prompt — into a plain string, or
// '' when it is not a finite number. Accounting parentheses, currency symbols,
// and thousands separators are tolerated.
export function toAmountString(value) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : ''
  }
  const s = String(value).trim()
  const negative = /^\(.*\)$/.test(s) || s.includes('-')
  const digits = s.replace(/[^0-9.]/g, '')
  if (digits === '' || digits === '.') return ''
  const n = Number(digits)
  if (!Number.isFinite(n)) return ''
  return String((negative ? -1 : 1) * (Math.round(n * 100) / 100))
}

// Flatten the vision accounts payload — [{ account, transactions: [{ date,
// reference, description, amount }] }] — into GL_COLUMNS rows, carrying each
// section's account onto every transaction (matching the XLSX / PDF GL parsers).
// A transaction with neither an amount nor any descriptive text is dropped.
// Returns a table { name, rows: [header, ...data], columnCount } or null when no
// usable transaction survives, so the caller can fall back silently.
export function accountsToTable(accounts = []) {
  const rows = []
  for (const acct of Array.isArray(accounts) ? accounts : []) {
    const account = String((acct && acct.account) || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!account) continue
    const txns = Array.isArray(acct && acct.transactions) ? acct.transactions : []
    for (const t of txns) {
      if (!t || typeof t !== 'object') continue
      const amount = toAmountString(t.amount)
      const date = String(t.date || '').trim()
      const reference = String(t.reference || '').trim()
      const description = String(t.description || '')
        .replace(/\s+/g, ' ')
        .trim()
      if (amount === '' && !description && !reference) continue
      // [Account, Date, Reference, Vendor, Description, Amount] — Vendor stays
      // empty (the description carries the vendor/memo), exactly like the PDF GL
      // text reconstructor's rows.
      rows.push([account, date, reference, '', description, amount])
    }
  }
  if (rows.length === 0) return null
  return { name: 'OCR GL', rows: [GL_COLUMNS.slice(), ...rows], columnCount: GL_COLUMNS.length }
}
