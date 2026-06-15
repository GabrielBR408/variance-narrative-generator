// --- Supporting-file enrichment — Phase 15 (public surface) ---------------
// Deterministic, client-side enrichment of a generated narrative with evidence
// drawn from supporting files. It runs AFTER the base narrative is produced and
// only ANNOTATES it: for each flagged (threshold-triggered) variance note, it
// looks for matching account detail in the supporting extractions and, when a
// confident deterministic match exists, appends a citation sentence and records
// the structured evidence on the note.
//
// Hard boundaries (Phase 15): pure and deterministic. NO AI/LLM, NO embeddings,
// NO vector DB, NO OCR, NO server, NO persistence, NO network. It never invents
// a figure, never asserts causation, and never changes the variance math — it
// only adds "this supporting file contains matching detail" language anchored to
// the file it came from.
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
import { citationText } from './templates.js'

// Only these sections hold flagged variance notes — they are the only ones we
// enrich. Executive Summary (a roll-up) and Missing Data (no comparison) are
// never annotated with evidence.
const ENRICHABLE_SECTIONS = ['highVariances', 'revenueNotes', 'expenseNotes']

// Enrich one note in place-free fashion: returns the same note when there is no
// confident match, or a new note carrying `support` + an appended citation
// sentence when there is.
function enrichNote(note, index, options) {
  if (!note || typeof note !== 'object' || !note.account || note.enriched) return note
  const citations = matchAccount(note.account, index, options)
  if (citations.length === 0) return note

  const support = citations.map((c) => ({
    fileName: c.fileName,
    classificationType: c.classificationType,
    confidence: c.confidence,
    sourceRows: c.sourceRows,
    text: citationText({ fileName: c.fileName, classificationType: c.classificationType, account: note.account })
  }))

  // Append citation sentence(s) to the existing text so every renderer (UI,
  // Markdown, DOCX) carries them automatically with no per-export wiring.
  const text = [note.text, ...support.map((s) => s.text)].join(' ')
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
        const enriched = enrichNote(note, index, options)
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
export { citationText, displayAccount } from './templates.js'
