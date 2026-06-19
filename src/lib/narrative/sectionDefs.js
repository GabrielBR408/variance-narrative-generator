// --- Shared narrative section definitions ---------------------------------
// The fixed, ordered owner-facing section list and the optional Context Notes
// catch-all. One source of truth so every surface that renders the narrative —
// the Markdown and DOCX exports, the Result panel, and the live Narrative
// Summary preview — stays in the same order with the same titles and can never
// drift. (The Excel owner-summary sheet uses a DIFFERENT, sheet-specific section
// list and is intentionally not driven by this.)

export const OWNER_SECTIONS = [
  { key: 'executiveSummary', title: 'Executive Summary' },
  { key: 'highVariances', title: 'High Variances' },
  { key: 'missingData', title: 'Missing Data' },
  { key: 'revenueNotes', title: 'Revenue Notes' },
  { key: 'expenseNotes', title: 'Expense Notes' }
]

// NQ-3C catch-all. Rendered AFTER the fixed five, and only when it carries
// re-homed rows, so a narrative with nothing to re-home stays byte-identical.
export const CONTEXT_SECTION = { key: 'contextNotes', title: 'Context Notes' }
