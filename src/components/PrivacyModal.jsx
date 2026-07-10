import React, { useRef } from 'react'
import { useDialogA11y } from '../hooks/useDialogA11y.js'

// First-visit privacy & AI disclosure. Shown once per browser; the
// acknowledgement is persisted in localStorage by App. Extracted verbatim from
// App() — onAccept records the acknowledgement and dismisses. Keyboard access:
// focus moves to the "I understand" button on open and Tab is trapped inside.
// Escape is deliberately a NO-OP (onEscape: null): accepting this notice
// permanently persists an acknowledgement of the privacy/AI terms, and consent
// must be explicit — a reflexive Escape (or one aimed at a dialog stacked on
// top) must never silently record it. The only way out is the button.
export default function PrivacyModal({ onAccept }) {
  const dialogRef = useRef(null)
  useDialogA11y({ dialogRef, onEscape: null })

  return (
    <div className="llm-disclosure-overlay" role="dialog" aria-modal="true" aria-labelledby="privacy-disclosure-title">
      <div className="llm-disclosure-dialog" ref={dialogRef} tabIndex={-1}>
        <h2 id="privacy-disclosure-title" className="llm-disclosure-title">Privacy &amp; AI Disclosure</h2>
        <p className="llm-disclosure-body">
          Your files are processed locally in your browser and are never stored on our servers. File content is only sent to Anthropic (creator of Claude AI) when GL transaction detail is sent to generate cited commentary, or when PDF text scanning is needed to read a file. Anthropic does not use API data for model training by default. See Anthropic&rsquo;s privacy policy at{' '}
          <a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener noreferrer">anthropic.com/privacy</a>{' '}
          for details on how API data is handled.
        </p>
        <p className="llm-disclosure-body">
          AI-generated narratives may contain errors or omissions. Always review and verify output against your source documents before distribution.
        </p>
        <div className="llm-disclosure-actions">
          <button type="button" className="llm-disclosure-btn llm-disclosure-btn--primary" onClick={onAccept}>
            I understand
          </button>
        </div>
      </div>
    </div>
  )
}
