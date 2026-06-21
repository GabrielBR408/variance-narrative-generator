import React from 'react'

// --- Upload guidance — minimal-default-layout phase ------------------------
// The explanatory upload note and the "What can I add here?" category list used
// to sit inside the upload card. They are relocated (unchanged) into the
// "Settings & instructions" panel so the default view stays minimal. Pure
// presentation — no state, no handlers.
const CATEGORIES = [
  'General Ledger (GL)',
  'Budget',
  'Prior Month Report',
  'Existing Variance Report',
  'Owner Report Example',
  'Supporting Documents'
]

export default function UploadGuidance() {
  return (
    <div className="upload-guidance">
      <p className="card-sub">
        Drop the base variance report and any supporting files together — we'll sort out which
        is which. The base is typically a comparative income statement, ideally in Excel.
      </p>

      <details className="helper">
        <summary>What can I add here?</summary>
        <ul className="helper-list">
          {CATEGORIES.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </details>
    </div>
  )
}
