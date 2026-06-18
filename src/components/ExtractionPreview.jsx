import React from 'react'
import { confidenceTier } from '../lib/classify.js'

// --- Extraction preview — Phase 7 -----------------------------------------
// Presentation only. It reads the normalized extraction objects produced by
// src/lib/extract and renders a collapsed, capped preview per file. No parser
// or normalization logic lives here — the UI never opens files itself.

const STATUS_LABEL = {
  pending: 'Extracting…',
  ok: 'Extracted',
  empty: 'No content',
  unavailable: 'Unavailable',
  error: 'Failed'
}

// How much we actually render (extraction itself is capped upstream).
const PREVIEW_ROWS = 5
const PREVIEW_COLS = 8

function rowAndColumnCounts(ex) {
  const n = ex.normalized || {}
  return {
    rows: Array.isArray(n.rows) ? n.rows.length : 0,
    columns: Array.isArray(n.columns) ? n.columns.length : 0
  }
}

function TablePreview({ columns, rows }) {
  const head = columns.slice(0, PREVIEW_COLS)
  const body = rows.slice(0, PREVIEW_ROWS)
  return (
    <div className="extract-table-wrap">
      <table className="extract-table">
        {head.length > 0 && (
          <thead>
            <tr>
              {head.map((c, i) => <th key={i}>{String(c)}</th>)}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              {(Array.isArray(row) ? row : [row]).slice(0, PREVIEW_COLS).map((cell, c) => (
                <td key={c}>{String(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TextPreview({ rows }) {
  const blocks = rows.slice(0, PREVIEW_ROWS)
  return (
    <ul className="extract-text">
      {blocks.map((row, i) => (
        <li key={i}>{Array.isArray(row) ? row.join(' ') : String(row)}</li>
      ))}
    </ul>
  )
}

function ExtractionItem({ extraction }) {
  const ex = extraction
  const status = ex.status || 'pending'
  const tier = confidenceTier(ex.confidence || 0)
  const { rows, columns } = rowAndColumnCounts(ex)
  const isTabular = columns > 0
  const klass = ex.classification?.type || '—'

  return (
    <details className="extract">
      <summary className="extract-summary">
        <span className="extract-name">{ex.fileName}</span>
        <span className="extract-class">{klass}</span>
        <span className={`extract-status extract-status--${status}`}>
          {STATUS_LABEL[status] || status}
        </span>
        {status === 'ok' && (
          <span className={`extract-conf extract-conf--${tier}`}>{ex.confidence}%</span>
        )}
      </summary>

      <div className="extract-body">
        {status === 'pending' && <p className="extract-msg">Reading file…</p>}

        {(status === 'unavailable' || status === 'error' || status === 'empty') && (
          <p className="extract-msg">{ex.message}</p>
        )}

        {status === 'ok' && (
          <>
            <div className="extract-stats">
              <span>Rows <strong>{rows}</strong></span>
              <span>Columns <strong>{columns}</strong></span>
              <span>Confidence <strong>{ex.confidence}%</strong></span>
            </div>
            <div className="extract-preview-label">Preview (first {PREVIEW_ROWS})</div>
            {isTabular
              ? <TablePreview columns={ex.normalized.columns} rows={ex.normalized.rows} />
              : <TextPreview rows={ex.normalized.rows} />}
          </>
        )}
      </div>
    </details>
  )
}

// `items` is an ordered list of extraction objects (or pending placeholders).
export default function ExtractionPreview({ items }) {
  if (!items || items.length === 0) return null
  return (
    <div className="card extract-card">
      <div className="card-label">Extraction Preview</div>
      <p className="card-sub">
        Content read in your browser. GL detail is sent to Anthropic to generate cited commentary — see disclosure for details.
      </p>
      <div className="extract-list">
        {items.map((ex) => <ExtractionItem key={ex.fileId} extraction={ex} />)}
      </div>
    </div>
  )
}
