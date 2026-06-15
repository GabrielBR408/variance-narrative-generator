import React from 'react'
import { generateButtonState, generateHint, isBusy } from '../lib/generateState.js'

// --- Generate panel — Phase 9C --------------------------------------------
// Presentation only. The readiness / loading / error decisions live in
// src/lib/generateState.js (pure, tested); this component just renders them.

export default function GeneratePanel({ status, message, readiness, onGenerate }) {
  const button = generateButtonState({ status, readiness })
  const hint = generateHint({ status, message, readiness })
  const busy = isBusy(status)

  return (
    <section className="step step--generate">
      <div className="step-head">
        <span className="step-eyebrow">Step 4</span>
        <h2 className="step-title">Generate</h2>
      </div>

      <button
        type="button"
        className="generate-btn"
        onClick={onGenerate}
        disabled={button.disabled}
        aria-busy={busy}
      >
        {button.label}
      </button>

      {/* Loading indication while the request is in flight. */}
      {busy && (
        <p className="generate-progress" role="status" aria-live="polite">
          <span className="generate-spinner" aria-hidden="true" />
          {status === 'preparing' ? 'Preparing your report…' : 'Generating your narrative…'}
        </p>
      )}

      {/* A single friendly note: an error from the last attempt, or a readiness
          hint (still reading the file / the file couldn't be read). */}
      {!busy && hint && (
        <p
          className={`generate-msg generate-msg--${hint.tone}`}
          role={hint.tone === 'error' ? 'alert' : 'status'}
        >
          {hint.text}
        </p>
      )}
    </section>
  )
}
