import React from 'react'
import { enrichmentDiagnostic } from '../lib/enrichmentDiagnostic.js'

// --- Enrichment diagnostic banner — presentation only ---------------------
// A small, deterministic status line that tells the user whether GL enrichment
// actually ran for the narrative(s) on screen. All counting lives in the pure
// `enrichmentDiagnostic` helper; this component only renders the result. It
// shows no amounts, vendors, or GL rows — counts and a coarse status only.
//
// Pass either a precomputed `diagnostic` (e.g. the generated result) or the raw
// `extractions` + `narratives` (e.g. the live preview); the helper is pure so
// both yield the same object.
export default function EnrichmentDiagnostic({ extractions = [], narratives = [], diagnostic }) {
  const d = diagnostic || enrichmentDiagnostic({ extractions, narratives })

  // Nothing meaningful to report (no narratives and no supporting files yet).
  if (d.narrativesTotal === 0 && d.supportingDetected === 0) return null

  return (
    <div className={`enrich-diag enrich-diag--${d.statusKind}`} role="status">
      <span className="enrich-diag-dot" aria-hidden="true" />
      <span className="enrich-diag-status">{d.status}</span>
      <span className="enrich-diag-counts">
        Supporting files detected: {d.supportingDetected} · GL files detected: {d.glDetected} ·
        Narratives enriched: {d.narrativesEnriched} / {d.narrativesTotal}
      </span>
    </div>
  )
}
