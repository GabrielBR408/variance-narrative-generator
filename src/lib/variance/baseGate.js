// --- Base-file pre-generate gate (structural, deterministic) ----------------
// Hard structural check that runs BEFORE computeVariance / enrichNarrative: if
// the base file does not carry the columns a comparative variance report has —
// an Actual column AND at least one of Budget or Prior — generation either
// auto-corrects (a single supporting file does carry them: promote it to base)
// or stops with a clear, actionable message naming the file. The bug it
// prevents is a misrouted base (a budget or a GL in the base slot) silently
// producing a "0 variances" result.
//
// Why this is the right level of check:
//   • detectComparisonSets is the same scorer computeVariance already runs to
//     decide whether a period is comparable; when it finds zero comparable sets,
//     computeVariance returns empty(reason:'no-comparable-columns') with nothing
//     for the narrative to say. That is precisely the silent failure mode the
//     gate replaces with an explicit STOP or an automatic swap.
//   • The orchestrator extends the same detector to supporting extractions —
//     read-only over `normalized.columns` / `normalized.rows` — so the swap is
//     decided by the same structural rule that gates the base. No new detector.
//
// Pure & deterministic. NO LLM, NO network, NO variance math beyond column
// detection. Reused by the /api/generate server path AND the static-host
// clientGenerate fallback, so one rule gates both.

import { detectComparisonSets } from './detectColumns.js'

// Reason codes — testable, exportable. Surface-only — never affects variance
// math when the gate passes.
export const BASE_GATE_OK = 'ok'
export const BASE_GATE_NO_COLUMNS = 'no-columns' // not tabular at all
export const BASE_GATE_NO_COMPARISON = 'no-comparable-columns' // headers don't read as Actual + Budget/Prior
export const BASE_GATE_AUTO_CORRECTED = 'auto-corrected' // base was swapped with a supporting file
export const BASE_GATE_NO_CANDIDATE = 'no-candidate' // base failed and no supporting file passes
export const BASE_GATE_MULTIPLE_CANDIDATES = 'multiple-candidates' // base failed and >1 supporting files pass

// --- Messages (named, actionable; replace the generic single-message gate) ---

export function messageNoCandidate(baseName = '') {
  const named = baseName ? `"${baseName}"` : 'The uploaded base file'
  return (
    `The file ${named} doesn't look like a comparative variance report ` +
    `(no Actual vs Budget columns found). Please upload a comparative income ` +
    `statement as the base file — it should have columns for both actual and ` +
    `budget figures.`
  )
}

export function messageMultipleCandidates(baseName = '', candidateNames = []) {
  const named = baseName ? `"${baseName}"` : 'The uploaded base file'
  const list = Array.isArray(candidateNames) && candidateNames.length
    ? ` Candidates: ${candidateNames.map((n) => `"${n}"`).join(', ')}.`
    : ''
  return (
    `The file ${named} doesn't look like a comparative variance report. ` +
    `Multiple files could be the base — please re-upload with the correct ` +
    `income statement as the first file.${list}`
  )
}

export function buildSwapNotice(originalBaseName = '', newBaseName = '') {
  return (
    `We detected "${originalBaseName}" is not a variance report — ` +
    `"${newBaseName}" looks like the right base file. ` +
    `We've adjusted the roles automatically.`
  )
}

// True iff the normalized shape carries at least one comparable set (Actual AND
// (Budget OR Prior)). The single structural predicate every outcome derives from.
function isVarianceReport(normalized) {
  const columns = normalized && Array.isArray(normalized.columns) ? normalized.columns : []
  const rows = normalized && Array.isArray(normalized.rows) ? normalized.rows : []
  if (columns.length === 0) return false
  const { sets } = detectComparisonSets(columns, rows)
  return Array.isArray(sets) && sets.some((s) => s && s.columns && s.columns.actual !== null && (s.columns.budget !== null || s.columns.prior !== null))
}

// Original single-file check. Kept for callers that only need the pass/fail.
// Returns { ok, reason, message }.
export function checkBaseIsVarianceReport(normalized, baseName = '') {
  const columns = normalized && Array.isArray(normalized.columns) ? normalized.columns : []
  if (columns.length === 0) {
    return { ok: false, reason: BASE_GATE_NO_COLUMNS, message: messageNoCandidate(baseName) }
  }
  if (!isVarianceReport(normalized)) {
    return { ok: false, reason: BASE_GATE_NO_COMPARISON, message: messageNoCandidate(baseName) }
  }
  return { ok: true, reason: BASE_GATE_OK, message: '' }
}

// Structural auto-correct orchestrator. Inspects the base + each supporting
// extraction with the same isVarianceReport predicate and returns one of four
// outcomes:
//
//   { outcome: 'pass', reason: 'ok' }
//   { outcome: 'auto_correct', reason, base, supporting, correction }
//   { outcome: 'stop_no_candidate', reason, message, baseFileName }
//   { outcome: 'stop_multiple_candidates', reason, message, baseFileName,
//     candidateNames }
//
// When auto-corrected, the returned `base` is the promoted supporting file and
// the returned `supporting` array is the original base demoted to position 0
// followed by the remaining supporting files (order preserved). The
// `correction` object mirrors the shape produced by the LLM role validator
// (corrected, notice, baseFileId, supportingFileIds) so downstream code
// (ResultPanel, ExportActions, Excel "File Roles" header) renders it identically.
export function evaluateBaseRouting({ base = null, supporting = [] } = {}) {
  const baseNorm = base && base.normalized

  if (isVarianceReport(baseNorm)) {
    return { outcome: 'pass', reason: BASE_GATE_OK }
  }

  const baseName = (base && base.fileName) || ''
  const supportingList = Array.isArray(supporting) ? supporting.filter(Boolean) : []
  const candidates = supportingList.filter((ex) => isVarianceReport(ex && ex.normalized))

  if (candidates.length === 0) {
    return {
      outcome: 'stop_no_candidate',
      reason: BASE_GATE_NO_CANDIDATE,
      message: messageNoCandidate(baseName),
      baseFileName: baseName
    }
  }

  if (candidates.length > 1) {
    const candidateNames = candidates.map((ex) => ex.fileName || '').filter(Boolean)
    return {
      outcome: 'stop_multiple_candidates',
      reason: BASE_GATE_MULTIPLE_CANDIDATES,
      message: messageMultipleCandidates(baseName, candidateNames),
      baseFileName: baseName,
      candidateNames
    }
  }

  // Exactly one supporting file passes — auto-correct.
  const newBase = candidates[0]
  const newSupporting = base
    ? [base, ...supportingList.filter((ex) => ex !== newBase)]
    : supportingList.filter((ex) => ex !== newBase)
  const newBaseName = (newBase && newBase.fileName) || ''
  const supportingFileIds = newSupporting
    .map((ex) => (ex && ex.fileId) || null)
    .filter((id) => id !== null)

  return {
    outcome: 'auto_correct',
    reason: BASE_GATE_AUTO_CORRECTED,
    base: newBase,
    supporting: newSupporting,
    correction: {
      corrected: true,
      notice: buildSwapNotice(baseName, newBaseName),
      baseFileId: (newBase && newBase.fileId) || null,
      supportingFileIds,
      originalBaseName: baseName,
      baseFileName: newBaseName
    }
  }
}
