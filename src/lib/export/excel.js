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
import { approxMoney } from '../enrich/index.js'
import { metaEntries } from './exportShared.js'
import { enrichmentStatusLine } from '../enrichmentStatus.js'

export const OWNER_SHEET = 'Owner Summary'
export const EVIDENCE_SHEET = 'Supporting Evidence'
export const EXCEL_TITLE = 'Variance Narrative — Owner Summary'

const CURRENCY_FMT = '$#,##0.00'
const PERCENT_FMT = '0.0%'

// Owner presentation sheet — Phase D: a single comparative income-statement
// layout. ONE row per account line, with the Current-period and Year-to-Date
// figures laid out SIDE BY SIDE (the same shape as the source comparative income
// statements) instead of the old stacked "Current then YTD" view. The financial
// grid leads, exactly the columns the spec names; all the existing descriptive
// data (status, category, narrative, supporting detail) is preserved, appended
// after the grid and grouped per period so nothing is dropped. Columns marked
// `percent` carry a fraction (value / 100) so the 0.0% number format renders.
export const OWNER_COLUMNS = [
  { header: 'Account', key: 'account', width: 32, wrap: true },
  // Current period — financial grid.
  { header: 'Current Actual', key: 'currentActual', width: 15, numFmt: CURRENCY_FMT },
  { header: 'Current Budget', key: 'currentComparison', width: 15, numFmt: CURRENCY_FMT },
  { header: 'Current Variance', key: 'currentVarianceAmount', width: 15, numFmt: CURRENCY_FMT },
  { header: 'Current Variance %', key: 'currentVariancePercent', width: 14, numFmt: PERCENT_FMT, percent: true },
  // Year-to-Date period — financial grid.
  { header: 'YTD Actual', key: 'ytdActual', width: 15, numFmt: CURRENCY_FMT },
  { header: 'YTD Budget', key: 'ytdComparison', width: 15, numFmt: CURRENCY_FMT },
  { header: 'YTD Variance', key: 'ytdVarianceAmount', width: 15, numFmt: CURRENCY_FMT },
  { header: 'YTD Variance %', key: 'ytdVariancePercent', width: 14, numFmt: PERCENT_FMT, percent: true },
  // Preserved descriptive data — Current period.
  { header: 'Current Category', key: 'currentCategory', width: 13 },
  { header: 'Current Status', key: 'currentSection', width: 16 },
  { header: 'Current Explanation', key: 'currentNarrative', width: 60, wrap: true },
  { header: 'Current Supporting Detail', key: 'currentSupporting', width: 36, wrap: true },
  // Preserved descriptive data — Year-to-Date period.
  { header: 'YTD Category', key: 'ytdCategory', width: 13 },
  { header: 'YTD Status', key: 'ytdSection', width: 16 },
  { header: 'YTD Explanation', key: 'ytdNarrative', width: 60, wrap: true },
  { header: 'YTD Supporting Detail', key: 'ytdSupporting', width: 36, wrap: true }
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
// The common file/classification/thresholds entries come from the shared
// metaEntries helper (so the three exports never disagree on them); the Excel
// sheet additionally stamps its own generated date. Each is included only when
// present so the sheet never asserts a value the narrative did not carry. The
// source file here is the BASE report (already shown in the Markdown/DOCX
// exports) — never a supporting file.
function buildMeta(narrative, generatedDate, enrichment, correction) {
  const meta = metaEntries(narrative)
  const date = formatDate(generatedDate)
  if (date) meta.push({ label: 'Generated', value: date })
  // Fix A: a single, self-documenting AI-status line so a downloaded file states
  // whether it is AI-enriched or a basic fallback (and why). Added only when an
  // enrichment status is supplied, so existing exports are unchanged.
  const statusLine = enrichmentStatusLine(enrichment)
  if (statusLine) meta.push({ label: 'AI Status', value: statusLine })
  // Generate-time role correction (Option A): when the base/supporting routing was
  // auto-corrected, record the notice so a downloaded file states it. Added only
  // when a correction occurred, so existing exports are unchanged.
  if (correction && typeof correction === 'object' && correction.notice) {
    meta.push({ label: 'File Roles', value: String(correction.notice) })
  }
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

// Stable key linking a full-table row to its narrated note: the account label
// plus its originating source-row index (each aligned row carries a unique
// index, so this disambiguates repeated account names).
function rowKey(account, sourceRows) {
  const first = Array.isArray(sourceRows) && sourceRows.length ? sourceRows[0] : ''
  return `${account || ''}#${first}`
}

// One per-account ENTRY for a single period (the pre-merge shape). Built either
// from a narrated note (legacy/fallback) or from a full-table variance row.
function entryFromNote(section, note) {
  return {
    account: note.account || '',
    section,
    actual: typeof note.actual === 'number' ? note.actual : null,
    comparison: typeof note.comparison === 'number' ? note.comparison : null,
    varianceAmount: typeof note.varianceAmount === 'number' ? note.varianceAmount : null,
    variancePercent: typeof note.variancePercent === 'number' ? note.variancePercent : null,
    category: note.category ? capitalize(note.category) : '',
    narrative: note.text || '',
    supporting: ownerSupportSummary(note)
  }
}

// Build the per-account ENTRIES for ONE period (figures + status + narrative +
// supporting detail). This is the per-period half of the old buildOwnerRows; the
// side-by-side merge below pairs the Current and YTD entries into one row.
//
// Phase 21.6: the entries carry the ENTIRE variance report — one entry for every
// line of the base report, not only the rows that crossed a threshold. The
// threshold governs solely whether an entry receives a narrative/commentary;
// below-threshold lines still appear, with blank Narrative and Supporting Detail.
//
// Narratives produced before allVariances existed (or hand-built fixtures) fall
// back to the original triggered + missing-only view.
function buildPeriodEntries(period) {
  const all = Array.isArray(period?.allVariances) ? period.allVariances : null

  // Fallback: no full-table metadata — emit the original notes-only view.
  if (!all) {
    const entries = []
    for (const { key, label } of SECTIONS) {
      const notes = Array.isArray(period?.[key]) ? period[key] : []
      for (const note of notes) entries.push(entryFromNote(label, note))
    }
    return entries
  }

  // Index the narrated notes so each full-table row can pull its text/support.
  const triggered = new Map()
  for (const note of Array.isArray(period.highVariances) ? period.highVariances : []) {
    triggered.set(rowKey(note.account, note.sourceRows), note)
  }
  const missing = new Map()
  for (const note of Array.isArray(period.missingData) ? period.missingData : []) {
    missing.set(rowKey(note.account, note.sourceRows), note)
  }

  return all.map((row) => {
    const key = rowKey(row.account, row.sourceRows)
    let section = 'Within Threshold'
    let narrative = ''
    let supporting = ''
    if (row.missingData) {
      section = 'Missing Data'
      const note = missing.get(key)
      narrative = (note && note.text) || ''
    } else if (row.thresholdTriggered) {
      section = 'High Variance'
      const note = triggered.get(key)
      narrative = (note && note.text) || ''
      supporting = note ? ownerSupportSummary(note) : ''
    } else if (row.rollup) {
      section = 'Total'
    }
    return {
      account: row.account || '',
      section,
      actual: typeof row.actual === 'number' ? row.actual : null,
      comparison: typeof row.comparison === 'number' ? row.comparison : null,
      varianceAmount: typeof row.varianceAmount === 'number' ? row.varianceAmount : null,
      variancePercent: typeof row.variancePercent === 'number' ? row.variancePercent : null,
      category: row.category ? capitalize(row.category) : '',
      narrative,
      supporting
    }
  })
}

// Index entries by account label, disambiguating repeated labels by their
// order of appearance, so the same account in Current and YTD pairs up even
// when the two periods carry different source-row indexes.
function indexByAccountOccurrence(entries) {
  const map = new Map()
  const counts = new Map()
  for (const e of entries) {
    const n = counts.get(e.account) || 0
    counts.set(e.account, n + 1)
    map.set(`${e.account}#${n}`, e)
  }
  return map
}

// Flatten a (Current, YTD) entry pair into one comparative owner row. Either
// side may be absent — a single-period or period-scoped narrative simply leaves
// the other side's columns blank.
function mergeOwnerRow(current, ytd) {
  const base = current || ytd || {}
  return {
    account: base.account || '',
    currentActual: current ? current.actual : null,
    currentComparison: current ? current.comparison : null,
    currentVarianceAmount: current ? current.varianceAmount : null,
    currentVariancePercent: current ? current.variancePercent : null,
    currentCategory: current ? current.category : '',
    currentSection: current ? current.section : '',
    currentNarrative: current ? current.narrative : '',
    currentSupporting: current ? current.supporting : '',
    ytdActual: ytd ? ytd.actual : null,
    ytdComparison: ytd ? ytd.comparison : null,
    ytdVarianceAmount: ytd ? ytd.varianceAmount : null,
    ytdVariancePercent: ytd ? ytd.variancePercent : null,
    ytdCategory: ytd ? ytd.category : '',
    ytdSection: ytd ? ytd.section : '',
    ytdNarrative: ytd ? ytd.narrative : '',
    ytdSupporting: ytd ? ytd.supporting : ''
  }
}

// Build the PURE owner-presentation rows from a (possibly enriched/scoped)
// narrative — ONE comparative row per account line, with the Current and YTD
// figures side by side (Phase D). The Current period drives row order; any
// YTD-only account (e.g. when scoped to YTD) is appended afterward. A narrative
// that carries a single period simply leaves the other side blank, so existing
// single-period and period-scoped exports keep all their data.
export function buildOwnerRows(narrative) {
  const periods = periodsOf(narrative)
  const currentPeriod = periods.find((p) => p?.period !== 'ytd') || null
  const ytdPeriod = periods.find((p) => p?.period === 'ytd') || null

  const currentEntries = currentPeriod ? buildPeriodEntries(currentPeriod) : []
  const ytdEntries = ytdPeriod ? buildPeriodEntries(ytdPeriod) : []
  const ytdByAccount = indexByAccountOccurrence(ytdEntries)

  const rows = []
  const matchedYtd = new Set()
  const counts = new Map()
  for (const ce of currentEntries) {
    const n = counts.get(ce.account) || 0
    counts.set(ce.account, n + 1)
    const key = `${ce.account}#${n}`
    const ye = ytdByAccount.get(key) || null
    if (ye) matchedYtd.add(key)
    rows.push(mergeOwnerRow(ce, ye))
  }

  // Append any YTD account line that had no Current counterpart.
  const ytdCounts = new Map()
  for (const ye of ytdEntries) {
    const n = ytdCounts.get(ye.account) || 0
    ytdCounts.set(ye.account, n + 1)
    const key = `${ye.account}#${n}`
    if (!matchedYtd.has(key)) rows.push(mergeOwnerRow(null, ye))
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
export function buildExcelModel(narrative, { generatedDate, enrichment, correction } = {}) {
  return {
    title: EXCEL_TITLE,
    meta: buildMeta(narrative, generatedDate, enrichment, correction),
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
    model.ownerColumns.forEach((col, ci) => {
      let value = row[col.key]
      // Percent columns store a fraction so the 0.0% number format renders.
      if (col.percent && typeof value === 'number') value = value / 100
      setCell(ws, r, ci, value)
    })
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
