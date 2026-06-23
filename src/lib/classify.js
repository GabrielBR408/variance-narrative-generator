// --- File classification — Phase 6 ----------------------------------------
// Best-guess of what an uploaded file represents, using ONLY surface signals:
// filename, extension, and upload role. It deliberately does NOT open, parse,
// OCR, or otherwise inspect file contents, and it never calls a model. Rules
// are deterministic so the same inputs always produce the same answer and the
// logic can be read and audited by hand.
//
// The result is advisory: classification never blocks an upload, works for any
// number of files, tolerates duplicate names (each file is judged on its own),
// and is shaped so a manual override can be layered on later.

import { detectStandaloneBudget, STANDALONE_BUDGET } from './extract/fileType.js'

export const FALLBACK_TYPE = 'Supporting Document'
export const FALLBACK_CONFIDENCE = 55

// Upload role is the strongest, most reliable signal: a file placed in the
// base slot IS the base variance report, whatever it happens to be named.
const ROLE_TYPE = {
  baseReport: { type: 'Base Variance Report', confidence: 100 }
}

// Keyword rules checked in order against the lowercased filename stem
// (extension removed). First match wins; its confidence is reported as-is.
// Patterns are kept readable on purpose so they are easy to audit and tune.
const RULES = [
  { type: 'General Ledger (GL)',      confidence: 95, re: /general[\s_-]*ledger|(^|[^a-z])gl([^a-z]|$)/ },
  { type: 'Budget',                   confidence: 95, re: /budget|forecast/ },
  { type: 'Prior Month Report',       confidence: 90, re: /prior|previous|last[\s_-]*month|prev[\s_-]*month/ },
  { type: 'Existing Variance Report', confidence: 90, re: /variance|var[\s_-]*report/ },
  { type: 'Owner Example',            confidence: 90, re: /owner|sample|example|template|exhibit/ }
]

export function extensionOf(name = '') {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

// Returns { type, confidence, basis }. `basis` records which signal decided
// the answer ('upload role' | 'filename' | 'default') for transparency.
export function classifyFile({ name = '', role } = {}) {
  // 1) Role wins outright when the slot tells us what the file is.
  if (role && ROLE_TYPE[role]) {
    return { ...ROLE_TYPE[role], basis: 'upload role' }
  }

  // 2) Filename keyword rules. Strip the extension first so "gl.csv" and
  //    "budget.xlsx" still match on their stems.
  const ext = extensionOf(name)
  const stem = (ext ? name.slice(0, name.length - ext.length - 1) : name).toLowerCase()

  for (const rule of RULES) {
    if (rule.re.test(stem)) {
      return { type: rule.type, confidence: rule.confidence, basis: 'filename' }
    }
  }

  // 3) Nothing matched — keep the upload, flag low confidence for override.
  return { type: FALLBACK_TYPE, confidence: FALLBACK_CONFIDENCE, basis: 'default' }
}

// Coarse confidence tier used by the UI for color/emphasis only.
export function confidenceTier(confidence) {
  if (confidence >= 85) return 'high'
  if (confidence >= 65) return 'med'
  return 'low'
}

// --- Content-aware refinement (Phase: content classification) --------------
// Refine a filename/role baseline using PARSED CONTENT once a file has been
// extracted. This is the only place content ever influences a type label, and it
// is deliberately narrow:
//
//   • It NEVER touches the base report. A file in the baseReport role resolves to
//     "Base Variance Report" by role precedence (basis 'upload role') BEFORE any
//     content logic; that baseline is returned unchanged, so base selection and
//     the computeVariance input contract are completely untouched.
//   • It only ever flips a NON-BASE file to "Budget", and only when the strict
//     standalone-budget content signature holds (budget basis AND no actuals AND
//     no variance AND no GL signal — see extract/fileType.js). Because that rule
//     requires the ABSENCE of the signals a GL or a comparative statement is
//     defined by, a real GL or base report can never be flipped to Budget.
//   • On any other content (or none), the filename/role baseline is kept as-is —
//     never guess, never demote (the safe default).
//
// `basis: 'content'` records that content decided, so the UI can show the
// corrected label distinctly.
export function classifyWithContent({ name = '', role, normalized, baseline } = {}) {
  const base = baseline || classifyFile({ name, role })
  // Role wins outright — the base slot is never content-classified.
  if (base.basis === 'upload role') return base

  const fileType = normalized && normalized.fileType
  const columns = normalized && normalized.columns
  if (fileType === STANDALONE_BUDGET || detectStandaloneBudget(columns)) {
    // Already named Budget by filename? Keep the filename basis/confidence; there
    // is nothing to correct. Otherwise surface the content-detected type.
    if (base.type === 'Budget') return base
    return { type: 'Budget', confidence: 90, basis: 'content' }
  }
  return base
}
