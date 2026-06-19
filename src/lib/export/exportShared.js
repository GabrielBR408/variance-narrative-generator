// --- Shared export helpers -------------------------------------------------
// Small pieces the Markdown / DOCX / Excel exporters all need, factored out so
// the three exports can never drift on WHICH metadata they show or HOW a
// period's notes are read. Each exporter still applies its OWN formatting
// (Markdown bullets, DOCX runs, Excel cells) — only the shared decisions live
// here.

import { formatMoney } from '../narrative/formatters.js'

// The metadata entries common to every export: source file, classification, and
// thresholds — each included only when the narrative actually carries it, so an
// export never asserts a value that was not present. Returned as structured
// { label, value } pairs; each exporter renders them in its own style (the Excel
// sheet appends its own "Generated" date entry afterward).
export function metaEntries(narrative) {
  const entries = []
  if (narrative?.fileName) entries.push({ label: 'Source File', value: narrative.fileName })
  if (narrative?.classification) entries.push({ label: 'Classification', value: narrative.classification })
  const t = narrative?.thresholds
  if (t && (t.amount != null || t.percent != null)) {
    entries.push({ label: 'Thresholds', value: `${formatMoney(t.amount ?? 0)} or ${t.percent ?? 0}%` })
  }
  return entries
}

// A period's notes for a section key, always an array (empty when absent).
export function notesOf(period, key) {
  return Array.isArray(period?.[key]) ? period[key] : []
}
