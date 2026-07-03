// --- Enrichment diagnostic — UI status only -------------------------------
// A deterministic, read-only summary of whether GL enrichment actually ran, so
// a user can tell at a glance why a narrative is bare. PURE: it only READS the
// already-computed extractions and enriched narratives and counts them. It does
// NO extraction, matching, enrichment, contribution ranking, variance math, or
// text generation, and it never changes narrative output — it only describes it.
//
// It never exposes raw GL rows, amounts, vendors, or any accounting artifact —
// only counts and a coarse status string.

// A supporting file is classified General Ledger when its type reads as GL.
// (Same surface signal the enrichment layer uses; copied here so this UI helper
// has no dependency on internal enrichment modules.)
const GL_TYPE_RE = /general\s*ledger|\bgl\b/i
const BASE_TYPE = 'Base Variance Report'

function isOk(ex) {
  return !!ex && ex.status === 'ok'
}
function typeOf(ex) {
  return (ex && ex.classification && ex.classification.type) || ''
}
function isGLType(t) {
  return GL_TYPE_RE.test(String(t))
}

// Sections that can carry a GL-supported variance note — the same sections
// enrichmentStatus.js scans. High Variances is capped at a few headline rows, so
// GL enrichment often lives only in Revenue/Expense Notes.
const FLAGGED_SECTIONS = ['highVariances', 'revenueNotes', 'expenseNotes']

// True when ANY flagged variance note in the narrative carries a GL supporting
// citation — the structured `support` metadata the enrichment layer attaches.
// This is the deterministic signal that GL enrichment ran for this narrative.
export function narrativeHasGLEnrichment(narrative) {
  const periods = narrative && Array.isArray(narrative.periods) ? narrative.periods : []
  return periods.some((p) =>
    FLAGGED_SECTIONS.some((key) =>
      (Array.isArray(p[key]) ? p[key] : []).some(
        (n) => Array.isArray(n.support) && n.support.some((s) => isGLType(s && s.classificationType))
      )
    )
  )
}

// Summarize enrichment status from the extraction list + the produced narratives.
//   extractions — the extraction objects in view (base + supporting, or just
//                 supporting); only `status` and `classification.type` are read.
//   narratives  — the enriched narratives being displayed.
// Returns { supportingDetected, glDetected, narrativesEnriched, narrativesTotal,
//           status, statusKind }. Pure — same inputs always yield the same object.
export function enrichmentDiagnostic({ extractions = [], narratives = [] } = {}) {
  const ok = (Array.isArray(extractions) ? extractions : []).filter(isOk)
  const supportingDetected = ok.filter((ex) => typeOf(ex) !== BASE_TYPE).length
  const glDetected = ok.filter((ex) => isGLType(typeOf(ex))).length

  const list = Array.isArray(narratives) ? narratives : []
  const narrativesTotal = list.length
  const narrativesEnriched = list.filter(narrativeHasGLEnrichment).length

  let status
  let statusKind
  if (glDetected === 0) {
    status = 'No GL supporting file detected'
    statusKind = 'none'
  } else if (narrativesEnriched === 0) {
    status = 'GL uploaded but no narratives enriched'
    statusKind = 'pending'
  } else {
    status = 'GL enrichment active'
    statusKind = 'active'
  }

  return { supportingDetected, glDetected, narrativesEnriched, narrativesTotal, status, statusKind }
}
