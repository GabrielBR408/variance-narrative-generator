import React from 'react'

// --- Generate-time role-correction notice (presentation only) ---------------
// Shown beside the enrichment status when the generate-time LLM validation
// re-routed which file is the base (Option A: auto-correct). Plain-language and
// non-alarming: it states the swap already happened and generation proceeded. All
// logic lives server-side; this component only renders the precomputed notice and
// returns null when no correction occurred.
export default function CorrectionNotice({ correction }) {
  if (!correction || typeof correction !== 'object' || !correction.notice) return null

  return (
    <div className="correction-notice" role="status">
      <span className="correction-notice-dot" aria-hidden="true" />
      <span className="correction-notice-message">{correction.notice}</span>
    </div>
  )
}
