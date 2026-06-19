import React from 'react'

// --- Enrichment status banner — Fix Phase A (presentation only) -------------
// A clear, non-alarming line telling the user whether THIS generation was
// AI-enriched or fell back to the basic deterministic narrative (and why). All
// logic lives in the pure `enrichmentStatus` helper; the precomputed object is
// stored on the result (see useGenerate). This component only renders it.
//
// It shows no amounts, vendors, or GL rows — a coarse status, a plain-language
// reason, and counts only. Returns null when there is nothing to report.
export default function EnrichmentStatus({ enrichment }) {
  if (!enrichment || typeof enrichment !== 'object' || !enrichment.message) return null

  const kind = enrichment.statusKind || 'none'
  return (
    <div className={`enrich-status enrich-status--${kind}`} role="status">
      <span className="enrich-status-dot" aria-hidden="true" />
      <span className="enrich-status-message">{enrichment.message}</span>
      {enrichment.eligibleCount > 0 && (
        <span className="enrich-status-counts">
          {enrichment.enrichedCount} of {enrichment.eligibleCount} lines AI-enriched
        </span>
      )}
    </div>
  )
}
