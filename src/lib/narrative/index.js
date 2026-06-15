// --- Narrative engine — Phase 9A (public surface) -------------------------
// Single import point for the deterministic narrative layer. Mirrors the shape
// of src/lib/variance/index.js: the orchestrators are the headline export, with
// the section/template/formatter helpers re-exported for tests and the UI.
//
// Boundaries: deterministic, browser-only, in-memory. No AI/LLM, no export, no
// persistence. Generates prose only from a variance result it is handed.

export { generateNarrative, generateNarratives, buildPeriodNarrative } from './generateNarrative.js'
export {
  buildExecutiveSummary,
  buildHighVariances,
  buildMissingData,
  buildRevenueNotes,
  buildExpenseNotes,
  unionSourceRows
} from './sections.js'
export {
  varianceSentence,
  missingSentence,
  executiveSentence,
  movementPhrase
} from './templates.js'
export {
  formatMoney,
  formatAbsMoney,
  formatAbsPercent,
  periodLabel,
  periodPhrase,
  comparisonBasis
} from './formatters.js'
