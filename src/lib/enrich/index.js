// --- Supporting-file enrichment — Phase 15 / 16 (public surface) ----------
// Deterministic, client-side enrichment of a generated narrative with evidence
// drawn from supporting files. It runs AFTER the base narrative is produced and
// only EXPLAINS it: for each flagged (threshold-triggered) variance note, it
// looks for matching account detail in the supporting extractions and, when a
// confident deterministic match exists, MERGES an owner-facing explanation clause
// into the note's sentence and records the structured evidence on the note.
//
// Phase 16: the merged clause reads like a property manager wrote it — it never
// renders a file name, "Supporting file", or debug/source language. It states a
// cause only when GL evidence is "thick" (a real amount/description was matched),
// is period-aware ("current-period" vs "year-to-date"), and never invents or
// quotes a figure from a supporting file.
//
// Hard boundaries: pure and deterministic. NO AI/LLM, NO embeddings, NO vector
// DB, NO OCR, NO server, NO persistence, NO network. It never invents a figure
// and never changes the variance math — the original dollar and percent on the
// base sentence are preserved exactly.
//
// Critical invariant: with no supporting files, or no confident matches, the
// returned narrative is the SAME object reference, so a base-only narrative
// renders byte-identically to today.
//
// Input narrative shape (from src/lib/narrative/generateNarrative.js):
//   { fileId, fileName, classification, thresholds, periods: [
//       { period, periodLabel, executiveSummary, highVariances, missingData,
//         revenueNotes, expenseNotes, sourceRows }, ... ] }

import { buildEvidenceIndex, matchAccount, CONFIDENCE_FLOOR, MAX_CITATIONS_PER_NOTE } from './match.js'
import { explanationClause } from './templates.js'

// Only these sections hold flagged variance notes — they are the only ones we
// enrich. Executive Summary (a roll-up) and Missing Data (no comparison) are
// never annotated with evidence.
const ENRICHABLE_SECTIONS = ['highVariances', 'revenueNotes', 'expenseNotes']

// Evidence priority for phrasing the merged clause: GL first (it may explain a
// cause), then budget, prior, variance, then any other supporting document.
function evidenceRank(classificationType = '') {
  const t = String(classificationType)
  if (/general\s*ledger|\bgl\b/i.test(t)) return 0
  if (/budget|forecast/i.test(t)) return 1
  if (/prior|previous/i.test(t)) return 2
  if (/variance/i.test(t)) return 3
  return 4
}

// Merge an explanation clause into the base variance sentence: drop the base
// sentence's trailing period and append ", <clause>." This keeps ONE owner-ready
// sentence (preferred over a second citation sentence) and preserves the original
// dollar and percent untouched.
function mergeClause(base, clause) {
  const trimmed = String(base).replace(/\s*\.\s*$/, '')
  return `${trimmed}, ${clause}.`
}

// Enrich one note in place-free fashion: returns the same note when there is no
// confident match, or a new note carrying structured `support` metadata and an
// owner-facing explanation merged into its sentence when there is. `period` is
// the period key ('current' | 'ytd' | …) so wording is period-aware.
function enrichNote(note, index, options, period) {
  if (!note || typeof note !== 'object' || !note.account || note.enriched) return note
  const citations = matchAccount(note.account, index, options)
  if (citations.length === 0) return note

  // Structured metadata for tooling/tests and the Excel export — never rendered
  // as final owner narrative text. `detail` carries the GL-detail summary.
  const support = citations.map((c) => ({
    fileName: c.fileName,
    classificationType: c.classificationType,
    confidence: c.confidence,
    sourceRows: c.sourceRows,
    thick: c.thick,
    detail: c.detail
  }))

  // Phrase the explanation from the single highest-priority match; all matches
  // stay in `support`. Stable sort keeps the existing file-name/source-row order
  // as the tie-break within a rank.
  const primary = [...support].sort((a, b) => evidenceRank(a.classificationType) - evidenceRank(b.classificationType))[0]
  const clause = explanationClause({
    classificationType: primary.classificationType,
    accountType: note.accountType,
    varianceAmount: note.varianceAmount,
    account: note.account,
    period,
    thick: primary.thick,
    detail: primary.detail
  })

  const text = clause ? mergeClause(note.text, clause) : note.text
  return { ...note, text, support, enriched: true }
}

// Enrich a generated narrative with supporting-file evidence. Returns the SAME
// narrative reference when nothing is added, guaranteeing byte-identical
// base-only output.
export function enrichNarrative(narrative, { supporting = [], floor = CONFIDENCE_FLOOR, cap = MAX_CITATIONS_PER_NOTE } = {}) {
  if (!narrative || !Array.isArray(narrative.periods) || narrative.periods.length === 0) return narrative

  const index = buildEvidenceIndex(supporting)
  if (index.length === 0) return narrative

  const options = { floor, cap }
  let changed = false

  const periods = narrative.periods.map((period) => {
    if (!period || typeof period !== 'object') return period
    const next = { ...period }
    for (const key of ENRICHABLE_SECTIONS) {
      const notes = Array.isArray(period[key]) ? period[key] : []
      next[key] = notes.map((note) => {
        const enriched = enrichNote(note, index, options, period.period)
        if (enriched !== note) changed = true
        return enriched
      })
    }
    return next
  })

  // No confident match anywhere → leave the narrative untouched (identity).
  if (!changed) return narrative
  return { ...narrative, periods }
}

export { buildEvidenceIndex, matchAccount, scoreMatch, normalizeName, accountCode, CONFIDENCE_FLOOR, MAX_CITATIONS_PER_NOTE } from './match.js'
export { explanationClause, displayAccount, descriptorFor, glDetailFragment } from './templates.js'
