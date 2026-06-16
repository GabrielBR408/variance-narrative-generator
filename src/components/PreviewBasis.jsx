import React from 'react'
import { previewBasis } from '../lib/previewNarrative.js'

// --- Preview basis (causality indicator) — Phase 22.1 ---------------------
// A tiny, deterministic banner that makes the mental model explicit: the BASE
// report drives the variance; supporting files only enrich the narrative. All
// wording and counts come from the pure `previewBasis` model so they can never
// drift from the base-only preview routing. Presentation only — no math, no
// text generation, nothing saved or sent.
export default function PreviewBasis({ items = [] }) {
  const basis = previewBasis({ items })

  // Nothing usable extracted yet → nothing to explain.
  if (!basis.hasBase && basis.supportingCount === 0) return null

  return (
    <div className="preview-basis" role="note">
      <div className="preview-basis-counts">
        <span className="preview-basis-chip">
          Base report: <strong>{basis.hasBase ? 1 : 0}</strong>
        </span>
        <span className="preview-basis-chip">
          Supporting files: <strong>{basis.supportingCount}</strong>
        </span>
      </div>
      <p className="preview-basis-note">{basis.summary}</p>
    </div>
  )
}
