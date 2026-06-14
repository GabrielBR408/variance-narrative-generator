import React from 'react'

const BUTTON_LABEL = {
  idle: 'Generate Narrative',
  preparing: 'Preparing…',
  sending: 'Sending…',
  success: 'Generate Narrative',
  failure: 'Generate Narrative'
}

export default function GeneratePanel({ status, busy, message, onGenerate }) {
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
        disabled={busy}
        aria-busy={busy}
      >
        {BUTTON_LABEL[status] || 'Generate Narrative'}
      </button>

      {status === 'failure' && message && (
        <p className="generate-msg generate-msg--error" role="alert">{message}</p>
      )}
    </section>
  )
}
