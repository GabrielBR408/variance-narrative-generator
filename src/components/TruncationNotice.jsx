import React from 'react'
import { truncationNotices } from '../lib/truncationNotice.js'

// Deterministic thousands grouping (comma), independent of the runtime locale so
// the rendered text is stable across environments (and CI).
function group(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// --- Truncation warning (presentation only) --------------------------------
// A prominent, always-visible alert shown when an uploaded file exceeded the
// extractor's row cap, so the user knows some rows — and any variance sitting in
// them — were NOT processed. Rendered OUTSIDE the collapsed settings panel (at
// the top of the workflow) so it can never hide inside a closed disclosure.
// All logic lives in the pure `truncationNotices` helper; this only renders.
export default function TruncationNotice({ items }) {
  const notices = truncationNotices(items)
  if (notices.length === 0) return null

  return (
    <div className="truncation-notice" role="alert">
      <span className="truncation-notice-title">Some rows were not processed</span>
      <ul className="truncation-notice-list">
        {notices.map((n, i) => (
          <li key={i}>
            <strong>{n.fileName}</strong>: only the first {group(n.rowsRead)} of{' '}
            {group(n.totalRows)} rows were read. Rows beyond that were not
            analyzed, so some variances may be missing. Split the file or raise the
            row cap to include them.
          </li>
        ))}
      </ul>
    </div>
  )
}
