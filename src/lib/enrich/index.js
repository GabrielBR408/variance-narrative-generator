// --- Supporting-file enrichment — Phase 15 / 16 / 17 / 17.1 (public surface) -
// Deterministic, client-side enrichment of a generated narrative with evidence
// drawn from supporting files. It runs AFTER the base narrative is produced and
// adds CONTEXT to it: for each flagged (threshold-triggered) variance note, it
// looks for matching account detail in the supporting extractions and, when a
// confident deterministic match exists, attaches owner-facing supporting language
// and records the structured evidence on the note.
//
// Phase 17.1 — accounting rule: the COMPARATIVE REPORT determines the variance;
// supporting files provide CONTEXT ONLY. So the language never asserts or implies
// causation. GL evidence renders as a STANDALONE evidence sentence (e.g. "GL
// detail shows approximately $17,400 of related electric activity during the
// period."); non-GL evidence stays a short conservative clause. It never renders
// a file name or "Supporting file" language, is period-aware (current vs
// year-to-date), and never invents or quotes a figure from a supporting file.
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
import { explanationClause, glEvidenceSentence, commentarySentence } from './templates.js'
import { classifyGLCommentary } from './classify.js'

// Only these sections hold flagged variance notes — they are the only ones we
// enrich. Executive Summary (a roll-up) and Missing Data (no comparison) are
// never annotated with evidence.
const ENRICHABLE_SECTIONS = ['highVariances', 'revenueNotes', 'expenseNotes']

// Evidence priority for phrasing the supporting line: GL first (it carries the
// richest deterministic detail), then budget, prior, variance, then any other
// supporting document. This selects which match phrases the supporting language;
// it implies no causation.
function evidenceRank(classificationType = '') {
  const t = String(classificationType)
  if (/general\s*ledger|\bgl\b/i.test(t)) return 0
  if (/budget|forecast/i.test(t)) return 1
  if (/prior|previous/i.test(t)) return 2
  if (/variance/i.test(t)) return 3
  return 4
}

function isGL(classificationType = '') {
  return /general\s*ledger|\bgl\b/i.test(String(classificationType))
}

// Merge a non-GL evidence clause into the variance sentence: drop the trailing
// period and append ", <clause>." Preserves the original dollar and percent.
function mergeClause(base, clause) {
  const trimmed = String(base).replace(/\s*\.\s*$/, '')
  return `${trimmed}, ${clause}.`
}

// Append a standalone GL evidence sentence (Phase 17.1) after the variance
// sentence, separated by a space, so the GL context never reads as a causal
// clause of the variance.
function appendSentence(base, sentence) {
  return `${String(base).replace(/\s+$/, '')} ${sentence}`
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

  // Phrase the supporting language from the single highest-priority match; all
  // matches stay in `support`. Stable sort keeps the existing file-name/source-row
  // order as the tie-break within a rank. GL renders as a STANDALONE evidence
  // sentence (Phase 17.1); non-GL stays a conservative merged clause.
  const primary = [...support].sort((a, b) => evidenceRank(a.classificationType) - evidenceRank(b.classificationType))[0]

  let text = note.text
  if (isGL(primary.classificationType)) {
    // Phase 19A: classify the GL evidence into one owner commentary category,
    // then render it. The variance sentence is preserved verbatim; the classified
    // GL sentence is appended as standalone context (never a causal clause).
    const { type } = classifyGLCommentary({
      detail: primary.detail,
      comparison: note.comparison,
      comparisonType: note.comparisonType,
      confidence: primary.confidence,
      thick: primary.thick
    })
    const sentence = commentarySentence({ type, account: note.account, detail: primary.detail, period })
    if (sentence) text = appendSentence(note.text, sentence)
  } else {
    const clause = explanationClause({ classificationType: primary.classificationType })
    if (clause) text = mergeClause(note.text, clause)
  }
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
export { explanationClause, glEvidenceSentence, commentarySentence, displayAccount, descriptorFor, approxMoney } from './templates.js'
export {
  classifyGLCommentary,
  CONF_G_MAX,
  CONF_AE_MIN,
  DOMINANCE_RATIO,
  CONCENTRATED_MIN_RATIO,
  RECURRING_MAX_RATIO,
  RECURRING_MIN_COUNT,
  RECURRING_MAX_COUNT
} from './classify.js'
