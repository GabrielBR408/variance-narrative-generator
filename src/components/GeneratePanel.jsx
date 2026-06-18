import React from 'react'
import {
  generateButtonState,
  generateHint,
  isBusy,
  pendingSupportingWarningVisible
} from '../lib/generateState.js'

// --- Generate panel — Phase 9C / 22.3 -------------------------------------
// Presentation only. The readiness / loading / error decisions live in
// src/lib/generateState.js (pure, tested); this component just renders them.

export default function GeneratePanel({ status, message, readiness, pendingSupporting = 0, onGenerate, llmMode = 'conservative', onRequestLlmMode }) {
  const button = generateButtonState({ status, readiness })
  const hint = generateHint({ status, message, readiness })
  const busy = isBusy(status)
  // Phase 22.3: a non-blocking notice when supporting files are still extracting.
  // Generate stays enabled — base-only generation is valid — but the user is told
  // the in-flight files won't be included yet.
  const showPending =
    !busy && pendingSupportingWarningVisible({ ready: readiness && readiness.ready, pendingCount: pendingSupporting })

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

      {/* Non-blocking: supporting files are still being read (Phase 22.3). */}
      {showPending && (
        <p className="generate-msg generate-msg--warn" role="status">
          Supporting files are still processing. Generate now to continue without them.
        </p>
      )}

      {/* NQ-6B: Commentary mode toggle. Conservative = deterministic only (default).
          Cited = LLM-enriched output with vendor citations. Requires disclosure. */}
      {onRequestLlmMode && (
        <div className="llm-mode-toggle" role="group" aria-label="Commentary mode">
          <button
            type="button"
            className={`llm-mode-btn${llmMode === 'conservative' ? ' llm-mode-btn--active' : ''}`}
            onClick={() => onRequestLlmMode('conservative')}
            aria-pressed={llmMode === 'conservative'}
          >
            Conservative
          </button>
          <button
            type="button"
            className={`llm-mode-btn${llmMode === 'cited' ? ' llm-mode-btn--active' : ''}`}
            onClick={() => onRequestLlmMode('cited')}
            aria-pressed={llmMode === 'cited'}
          >
            Cited
          </button>
        </div>
      )}
    </section>
  )
}
