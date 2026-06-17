// --- Narrative export — Phase 10A (Markdown) ------------------------------
// Turns ONE generated narrative (the `result.narrative` object returned by the
// generate flow) into a deterministic, owner-readable Markdown document. This
// is the single source of the exported text — both "Copy Narrative" and the
// `.md` download read from here so the two can never drift.
//
// Hard boundaries (Phase 10A): deterministic and pure. No storage, no document
// rendering, no network, no AI/LLM. The function only re-formats text the
// narrative engine already produced — it never invents a value, re-sums a
// figure, or emits raw JSON. Source-row traceability is preserved on the
// narrative object itself (notes still carry `sourceRows`); the owner-facing
// document intentionally does not print those indices.
//
// Input shape (from src/lib/narrative/generateNarrative.js):
//   { fileId, fileName, classification, thresholds, periods: [
//       { period, periodLabel, executiveSummary, highVariances, missingData,
//         revenueNotes, expenseNotes, sourceRows }, ... ] }

import { formatMoney } from '../narrative/formatters.js'

// Fixed section order. Stable across every export so two owners comparing the
// same narrative see the same document, byte for byte.
const SECTIONS = [
  { key: 'executiveSummary', title: 'Executive Summary' },
  { key: 'highVariances', title: 'High Variances' },
  { key: 'missingData', title: 'Missing Data' },
  { key: 'revenueNotes', title: 'Revenue Notes' },
  { key: 'expenseNotes', title: 'Expense Notes' }
]

const TITLE = 'Variance Narrative'
const EMPTY_NARRATIVE_NOTE =
  '_No comparable variance data was found in the base report, so there is nothing to narrate._'
const EMPTY_SECTION_NOTE = '_None._'

function notesOf(period, key) {
  return Array.isArray(period?.[key]) ? period[key] : []
}

// Header lines: file, classification, thresholds. Each is included only when
// present so the document never asserts a value the narrative did not carry.
function metadataLines(narrative) {
  const lines = []
  if (narrative?.fileName) lines.push(`- **Source File:** ${narrative.fileName}`)
  if (narrative?.classification) lines.push(`- **Classification:** ${narrative.classification}`)
  const t = narrative?.thresholds
  if (t && (t.amount != null || t.percent != null)) {
    lines.push(`- **Thresholds:** ${formatMoney(t.amount ?? 0)} or ${t.percent ?? 0}%`)
  }
  return lines
}

// One section: a `###` heading followed by either a bullet per note (in the
// engine's already-deterministic order) or an explicit "None" so the structure
// is complete and stable even when a section is empty.
function sectionBlock(period, { key, title }) {
  const notes = notesOf(period, key)
  const lines = [`### ${title}`, '']
  if (notes.length === 0) {
    lines.push(EMPTY_SECTION_NOTE)
  } else {
    for (const n of notes) lines.push(`- ${n.text}`)
  }
  return lines
}

// Context Notes (NQ-3C) renders after the fixed five, but ONLY when it carries
// rows — an empty catch-all prints nothing, so a narrative with nothing to
// re-home stays byte-identical to before.
const CONTEXT_SECTION = { key: 'contextNotes', title: 'Context Notes' }

// One period (Current / YTD / …): a `##` heading and the five sections, plus the
// optional Context Notes section when non-empty.
function periodBlock(period) {
  const lines = [`## ${period?.periodLabel || 'Current'}`, '']
  SECTIONS.forEach((section, i) => {
    if (i > 0) lines.push('')
    lines.push(...sectionBlock(period, section))
  })
  if (notesOf(period, CONTEXT_SECTION.key).length > 0) {
    lines.push('')
    lines.push(...sectionBlock(period, CONTEXT_SECTION))
  }
  return lines
}

// Build the full Markdown document for one narrative. Pure: identical input
// always yields an identical string.
export function narrativeToMarkdown(narrative) {
  const lines = [`# ${TITLE}`, '']

  const meta = metadataLines(narrative)
  if (meta.length > 0) {
    lines.push(...meta, '')
  }

  const periods = Array.isArray(narrative?.periods) ? narrative.periods : []
  if (periods.length === 0) {
    lines.push(EMPTY_NARRATIVE_NOTE, '')
    return lines.join('\n').replace(/\n+$/, '\n')
  }

  periods.forEach((period, i) => {
    if (i > 0) lines.push('')
    lines.push(...periodBlock(period))
  })

  // Single trailing newline — stable, POSIX-friendly file ending.
  return lines.join('\n').replace(/\n+$/, '\n')
}

// The text placed on the clipboard by "Copy Narrative". It is the same Markdown
// as the download so copy and export are byte-identical, preserving formatting.
export function narrativeToClipboardText(narrative) {
  return narrativeToMarkdown(narrative)
}
