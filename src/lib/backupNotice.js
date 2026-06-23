// --- Insufficient-backup notice — input-guidance phase (surface only) -------
// After a narrative is generated, this produces a short, non-alarming notice
// recommending a supporting input the user did NOT provide that would have
// strengthened the variance commentary. It is DISPLAY guidance only: it reads
// what was already produced and never changes variance logic, enrichment,
// thresholds, or narrative text.
//
// DETECTION = presence / file-type only (Option 1). It does NO outcome or
// enrichment-ratio analysis. Pure and deterministic: the same inputs always
// yield the same notice (or null).
//
// "Only if the app can't make do" rule: a recommendation appears ONLY for an
// input that was actually needed and absent. Critically, in this app the budget
// COMPARISON is derived from the base report's own budget column (see
// src/lib/variance/calculate.js) — a separate budget FILE is never read for the
// variance basis. So the budget recommendation fires only when there is no
// budget basis at all (the base report did not compare actuals against plan),
// never merely because a budget file was not uploaded. Otherwise the app "made
// do" and we stay silent.
//
// Case #3 (a GL that is current-month-only rather than year-to-date) is
// deliberately NOT detected: the app cannot reliably distinguish the two from
// what is parsed (heterogeneous date strings, no period-coverage signal, and a
// legitimate YTD GL early in a fiscal year carries only one month), so a wrong
// "you uploaded the wrong GL" warning would erode trust more than silence.

import { classifyFile } from './classify.js'

// Same surface signal the rest of the app uses for a General Ledger file.
const GL_TYPE_RE = /general\s*ledger|\bgl\b/i

// Sections whose notes carry a comparisonType, used as the fallback budget-basis
// signal when the variance column map is unavailable.
const NOTE_SECTIONS = ['highVariances', 'revenueNotes', 'expenseNotes', 'missingData']

// The fixed recommendation copy (kept here as the single source of truth).
export const BUDGET_RECOMMENDATION = 'Add a detailed budget to compare actuals against plan.'
export const GL_RECOMMENDATION = 'Add a year-to-date GL so commentary can cite specific entries.'

// True when actuals were compared against a budget anywhere in this result. The
// authoritative signal is the variance column map (a detected budget column in
// the base report); the note scan is a resilient fallback when the column map is
// absent (e.g. a server response shape without it).
function hasBudgetBasis(variance, narrative) {
  if (variance && variance.columns && variance.columns.budget != null) return true
  const periods = (narrative && Array.isArray(narrative.periods)) ? narrative.periods : []
  for (const p of periods) {
    for (const key of NOTE_SECTIONS) {
      const notes = Array.isArray(p && p[key]) ? p[key] : []
      for (const n of notes) if (n && n.comparisonType === 'budget') return true
    }
  }
  return false
}

// True when a General Ledger was provided among the uploaded files. Presence /
// file-type only — the same advisory classifier the UI already uses on uploads.
function hasGL(files) {
  const list = Array.isArray(files) ? files : []
  return list.some((f) => GL_TYPE_RE.test(classifyFile({ name: (f && f.name) || '', role: f && f.role }).type))
}

// Build the notice for one generated result, or null when every needed input was
// present and the app made do. Returns:
//   { recommendations: string[] }
export function backupNotice({ narrative = null, variance = null, files = [] } = {}) {
  const recommendations = []
  if (!hasBudgetBasis(variance, narrative)) recommendations.push(BUDGET_RECOMMENDATION)
  if (!hasGL(files)) recommendations.push(GL_RECOMMENDATION)
  if (recommendations.length === 0) return null
  return { recommendations }
}
