import React, { useRef } from 'react'
import { useDialogA11y } from '../hooks/useDialogA11y.js'

// AI commentary data notice (UX-1). Shown on the first Generate click in a
// session; generation runs once it is acknowledged. Extracted verbatim from
// App() — onAccept enables AI mode and generates, onDismiss cancels. Keyboard
// access: focus moves to the primary button on open, Escape cancels (same as
// the Cancel button), and focus returns to the Generate trigger on close.
export default function DisclosureModal({ onAccept, onDismiss }) {
  const dialogRef = useRef(null)
  useDialogA11y({ dialogRef, onEscape: onDismiss })

  return (
    <div className="llm-disclosure-overlay" role="dialog" aria-modal="true" aria-labelledby="llm-disclosure-title">
      <div className="llm-disclosure-dialog" ref={dialogRef} tabIndex={-1}>
        <h2 id="llm-disclosure-title" className="llm-disclosure-title">AI Commentary — Data Notice</h2>
        <p className="llm-disclosure-body">
          Generating AI commentary sends your GL transaction detail to Anthropic's API to produce vendor-cited narratives. No data is stored on our servers. See Anthropic's privacy policy for API data handling.
        </p>
        <div className="llm-disclosure-actions">
          <button type="button" className="llm-disclosure-btn llm-disclosure-btn--primary" onClick={onAccept}>
            I understand — enable AI mode
          </button>
          <button type="button" className="llm-disclosure-btn llm-disclosure-btn--secondary" onClick={onDismiss}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
