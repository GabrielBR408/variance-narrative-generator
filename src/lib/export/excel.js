// --- Narrative export — Phase 17 (Excel / .xlsx) --------------------------
// Turns ONE generated narrative (the `result.narrative` object, optionally
// enriched and period-scoped) into a deterministic, presentation-ready Excel
// workbook. It is the Excel sibling of markdown.js / docx.js and reads the exact
// same narrative object, so the three exports can never describe different
// numbers.
//
// Hard boundaries (Phase 17): browser-only, deterministic, pure data → workbook.
// No server-side generation, no storage, no persistence, no network, no AI/LLM.
// It only re-formats figures and text the narrative engine already produced —
// it never invents a value, re-sums a variance, or emits raw JSON. The owner
// sheet never prints a supporting-file name or "Supporting file" language; an
// optional second sheet carries supporting-evidence metadata (including file
// names) purely for traceability/debugging.
//
// Dependency: `exceljs` — chosen for full styling the community `xlsx` build
// cannot write (bold headers, frozen top row, wrapped text), plus column widths
// and currency/percent number formats. Runs in the browser via writeBuffer.
//
// Structure mirrors docx.js: a PURE model (buildExcelModel) the test suite can
// assert against without unzipping OOXML, and a renderer (buildExcelWorkbook)
// that turns the model into an ExcelJS workbook. One source of structure → the
// rendered sheet and the asserted model can never drift.

import ExcelJS from 'exceljs'
import { formatMoney } from '../narrative/formatters.js'
import { approxMoney } from '../enrich/index.js'

export const OWNER_SHEET = 'Owner Summary'
export const EVIDENCE_SHEET = 'Supporting Evidence'
export const EXCEL_TITLE = 'Variance Narrative — Owner Summary'

const CURRENCY_FMT = '$#,##0.00'
const PERCENT_FMT = '0.0%'

// Owner presentation sheet: the columns the spec names, with widths, number
// formats, and which carry wrapped long text.
export const OWNER_COLUMNS = [
  { header: 'Section', key: 'section', width: 16 },
  { header: 'Period', key: 'period', width: 12 },
  { header: 'Account', key: 'account', width: 30, wrap: true },
  { header: 'Actual', key: 'actual', width: 15, numFmt: CURRENCY_FMT },
  { header: 'Budget / Prior', key: 'comparison', width: 16, numFmt: CURRENCY_FMT },
  { header: 'Variance $', key: 'varianceAmount', width: 15, numFmt: CURRENCY_FMT },
  { header: 'Variance %', key: 'variancePercent', width: 12, numFmt: PERCENT_FMT },
  { header: 'Category', key: 'category', width: 13 },
  { header: 'Narrative / Explanation', key: 'narrative', width: 64, wrap: true },
  { header: 'Supporting Detail', key: 'supporting', width: 40, wrap: true }
]

// Optional evidence/debug sheet: traceability for each matched supporting file.
export const EVIDENCE_COLUMNS = [
  { header: 'Period', key: 'period', width: 12 },
  { header: 'Account', key: 'account', width: 28, wrap: true },
  { header: 'Supporting File', key: 'fileName', width: 30, wrap: true },
  { header: 'Type', key: 'type', width: 22 },
  { header: 'Confidence', key: 'confidence', width: 12, numFmt: '0.00' },
  { header: 'Matches', key: 'matches', width: 10 },
  { header: 'GL Total', key: 'total', width: 15, numFmt: CURRENCY_FMT },
  { header: 'Vendor / Description', key: 'vendor', width: 30, wrap: true },
  { header: 'Source Rows', key: 'sourceRows', width: 16 }
]

const SECTIONS = [
  { key: 'highVariances', label: 'High Variance' },
  { key: 'missingData', label: 'Missing Data' }
]

function capitalize(s) {
  const t = String(s || '')
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}

function periodsOf(narrative) {
  return Array.isArray(narrative?.periods) ? narrative.periods : []
}

// Format a generated-date input deterministically as YYYY-MM-DD. Accepts a Date
// or an ISO-ish string; returns '' for anything unusable.
function formatDate(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// The header metadata block (file, classification, thresholds, generated date).
// Each line is included only when present so the sheet never asserts a value the
// narrative did not carry. The source file here is the BASE report (already
// shown in the Markdown/DOCX exports) — never a supporting file.
function buildMeta(narrative, generatedDate) {
  const meta = []
  if (narrative?.fileName) meta.push({ label: 'Source File', value: narrative.fileName })
  if (narrative?.classification) meta.push({ label: 'Classification', value: narrative.classification })
  const t = narrative?.thresholds
  if (t && (t.amount != null || t.percent != null)) {
    meta.push({ label: 'Thresholds', value: `${formatMoney(t.amount ?? 0)} or ${t.percent ?? 0}%` })
  }
  const date = formatDate(generatedDate)
  if (date) meta.push({ label: 'Generated', value: date })
  return meta
}

// The highest-priority supporting match on a note (GL first), used for the owner
// "Supporting Detail" column and the primary evidence row.
function evidenceRank(type = '') {
  const t = String(type)
  if (/general\s*ledger|\bgl\b/i.test(t)) return 0
  if (/budget|forecast/i.test(t)) return 1
  if (/prior|previous/i.test(t)) return 2
  if (/variance/i.test(t)) return 3
  return 4
}

function primarySupport(note) {
  const support = Array.isArray(note?.support) ? note.support : []
  if (support.length === 0) return null
  return [...support].sort((a, b) => evidenceRank(a.classificationType) - evidenceRank(b.classificationType))[0]
}

// A concise, owner-facing supporting-detail string — NO file name, NO "Supporting
// file" language. Summarizes the structured GL detail (count / vendor / total)
// or names the evidence kind for non-GL support.
function ownerSupportSummary(note) {
  const p = primarySupport(note)
  if (!p) return ''
  const type = String(p.classificationType || '')
  if (/general\s*ledger|\bgl\b/i.test(type)) {
    const d = p.detail || {}
    const count = Number(d.count) || 0
    const parts = []
    if (d.topVendorCount > 1 && d.topVendor) parts.push(String(d.topVendor).replace(/\s+/g, ' ').trim())
    else if (count > 0) parts.push(`${count} GL ${count === 1 ? 'entry' : 'entries'}`)
    if (typeof d.total === 'number' && Number.isFinite(d.total) && d.total !== 0) {
      // Display only: present the rounded "approximately" style the narrative
      // uses, so the two surfaces match. The raw total is preserved internally
      // (and printed exactly in the evidence sheet's GL Total column).
      parts.push(`~${approxMoney(d.total)}`)
    }
    return parts.length ? `GL: ${parts.join(' · ')}` : 'GL match'
  }
  if (/budget|forecast/i.test(type)) return 'Budget reference'
  if (/prior|previous/i.test(type)) return 'Prior-period detail'
  if (/variance/i.test(type)) return 'Variance detail'
  return 'Matching detail'
}

// Build the PURE owner-presentation rows from a (possibly enriched/scoped)
// narrative. One row per High-Variance note and per Missing-Data note, in the
// engine's deterministic order, across every period present.
export function buildOwnerRows(narrative) {
  const rows = []
  for (const period of periodsOf(narrative)) {
    const periodLabel = period?.periodLabel || 'Current'
    for (const { key, label } of SECTIONS) {
      const notes = Array.isArray(period?.[key]) ? period[key] : []
      for (const note of notes) {
        rows.push({
          section: label,
          period: periodLabel,
          account: note.account || '',
          actual: typeof note.actual === 'number' ? note.actual : null,
          comparison: typeof note.comparison === 'number' ? note.comparison : null,
          varianceAmount: typeof note.varianceAmount === 'number' ? note.varianceAmount : null,
          variancePercent: typeof note.variancePercent === 'number' ? note.variancePercent : null,
          category: note.category ? capitalize(note.category) : '',
          narrative: note.text || '',
          supporting: ownerSupportSummary(note)
        })
      }
    }
  }
  return rows
}

// Build the PURE supporting-evidence rows: one per matched supporting file per
// enriched note, for traceability. This is the only place a file name appears.
export function buildEvidenceRows(narrative) {
  const rows = []
  for (const period of periodsOf(narrative)) {
    const periodLabel = period?.periodLabel || 'Current'
    const notes = Array.isArray(period?.highVariances) ? period.highVariances : []
    for (const note of notes) {
      const support = Array.isArray(note.support) ? note.support : []
      for (const s of support) {
        const d = s.detail || {}
        rows.push({
          period: periodLabel,
          account: note.account || '',
          fileName: s.fileName || '',
          type: s.classificationType || '',
          confidence: typeof s.confidence === 'number' ? s.confidence : null,
          matches: Number(d.count) || 0,
          total: typeof d.total === 'number' && Number.isFinite(d.total) ? d.total : null,
          vendor: d.topVendorCount > 1 && d.topVendor ? String(d.topVendor) : '',
          sourceRows: Array.isArray(s.sourceRows) ? s.sourceRows.join(', ') : ''
        })
      }
    }
  }
  return rows
}

// The full pure model the renderer consumes and tests assert against.
export function buildExcelModel(narrative, { generatedDate } = {}) {
  return {
    title: EXCEL_TITLE,
    meta: buildMeta(narrative, generatedDate),
    ownerColumns: OWNER_COLUMNS,
    ownerRows: buildOwnerRows(narrative),
    evidenceColumns: EVIDENCE_COLUMNS,
    evidenceRows: buildEvidenceRows(narrative)
  }
}

// --- rendering -------------------------------------------------------------

function applyColumnFormats(ws, columns) {
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    col.width = c.width
    if (c.numFmt) col.numFmt = c.numFmt
    if (c.wrap) col.alignment = { wrapText: true, vertical: 'top' }
  })
}

function writeHeaderRow(ws, columns, rowIdx) {
  columns.forEach((c, i) => {
    const cell = ws.getCell(rowIdx, i + 1)
    cell.value = c.header
    cell.font = { bold: true }
    cell.alignment = { wrapText: true, vertical: 'middle' }
  })
}

function setCell(ws, r, ci, value) {
  if (value === null || value === undefined || value === '') return
  ws.getCell(r, ci + 1).value = value
}

function renderOwnerSheet(wb, model) {
  const ws = wb.addWorksheet(OWNER_SHEET)
  applyColumnFormats(ws, model.ownerColumns)

  let r = 1
  ws.mergeCells(r, 1, r, model.ownerColumns.length)
  const title = ws.getCell(r, 1)
  title.value = model.title
  title.font = { bold: true, size: 14 }
  r += 2 // leave a blank spacer row

  for (const m of model.meta) {
    ws.getCell(r, 1).value = m.label
    ws.getCell(r, 1).font = { bold: true }
    ws.mergeCells(r, 2, r, model.ownerColumns.length)
    ws.getCell(r, 2).value = m.value
    r++
  }
  r++ // blank row before the table

  const headerRow = r
  writeHeaderRow(ws, model.ownerColumns, headerRow)
  ws.views = [{ state: 'frozen', ySplit: headerRow }]
  r++

  for (const row of model.ownerRows) {
    setCell(ws, r, 0, row.section)
    setCell(ws, r, 1, row.period)
    setCell(ws, r, 2, row.account)
    setCell(ws, r, 3, row.actual)
    setCell(ws, r, 4, row.comparison)
    setCell(ws, r, 5, row.varianceAmount)
    // Percent stored as a fraction so the 0.0% number format renders correctly.
    setCell(ws, r, 6, row.variancePercent === null ? null : row.variancePercent / 100)
    setCell(ws, r, 7, row.category)
    setCell(ws, r, 8, row.narrative)
    setCell(ws, r, 9, row.supporting)
    r++
  }
  return ws
}

function renderEvidenceSheet(wb, model) {
  if (model.evidenceRows.length === 0) return null
  const ws = wb.addWorksheet(EVIDENCE_SHEET)
  applyColumnFormats(ws, model.evidenceColumns)
  writeHeaderRow(ws, model.evidenceColumns, 1)
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  let r = 2
  for (const row of model.evidenceRows) {
    setCell(ws, r, 0, row.period)
    setCell(ws, r, 1, row.account)
    setCell(ws, r, 2, row.fileName)
    setCell(ws, r, 3, row.type)
    setCell(ws, r, 4, row.confidence)
    setCell(ws, r, 5, row.matches)
    setCell(ws, r, 6, row.total)
    setCell(ws, r, 7, row.vendor)
    setCell(ws, r, 8, row.sourceRows)
    r++
  }
  return ws
}

// Build an ExcelJS workbook from one narrative. Deterministic structure; the
// only non-determinism ExcelJS adds is internal zip/timestamp metadata.
export function buildExcelWorkbook(narrative, options = {}) {
  const model = buildExcelModel(narrative, options)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Variance Narrative Generator'
  renderOwnerSheet(wb, model)
  renderEvidenceSheet(wb, model)
  return wb
}

// Browser export: produce a Blob the page can download with no server round
// trip. Async because ExcelJS writes the zip asynchronously.
export async function narrativeToExcelBlob(narrative, options = {}) {
  const buffer = await buildExcelWorkbook(narrative, options).xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
}

// Node-only helper for the test suite — the same workbook as a Buffer so tests
// can re-read a real, valid .xlsx without a browser.
export function narrativeToExcelBuffer(narrative, options = {}) {
  return buildExcelWorkbook(narrative, options).xlsx.writeBuffer()
}
