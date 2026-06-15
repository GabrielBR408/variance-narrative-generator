// --- Export-flow UI state — Phase 10A -------------------------------------
// Deterministic, framework-free view-model helpers for the export experience.
// Same pattern as src/lib/generateState.js: the availability / filename rules
// live here as pure functions so they can be unit tested with `node --test`
// and stay identical wherever they are used.
//
// Boundaries: presentation logic only. No storage, no document rendering, no
// network, no AI/LLM. These helpers decide whether export is offered and what
// the download is named; they never build the narrative or its Markdown.

// Does the result carry a narrative object we can export at all?
export function hasNarrative(narrative) {
  return !!(narrative && typeof narrative === 'object' && Array.isArray(narrative.periods))
}

// Export actions appear only after a successful generation that returned a
// narrative. An empty narrative (no periods) is still exportable — its Markdown
// states plainly that there was nothing to narrate — so availability gates on a
// completed generation, not on whether any variance happened to trigger.
export function canExport({ status, narrative } = {}) {
  return status === 'success' && hasNarrative(narrative)
}

// Slug a source filename into a safe, deterministic stem for the .md download.
// Drops the original extension, lowercases, and collapses anything that is not
// a letter or digit into single hyphens.
function slugify(name) {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug
}

// Deterministic download filename. Always ends in `.md`; falls back to a stable
// generic name when the narrative carries no usable source filename.
export function exportFileName(narrative) {
  const raw = narrative?.fileName
  const slug = typeof raw === 'string' ? slugify(raw) : ''
  return slug ? `${slug}-variance-narrative.md` : 'variance-narrative.md'
}

// Deterministic .docx download filename (Phase 11). Mirrors exportFileName but
// for the Word export, with the spec's stable fallback when no usable source
// filename is present.
export function docxFileName(narrative) {
  const raw = narrative?.fileName
  const slug = typeof raw === 'string' ? slugify(raw) : ''
  return slug ? `${slug}-variance-narrative-summary.docx` : 'variance-narrative-summary.docx'
}

// Deterministic .xlsx download filename (Phase 17). Mirrors the other export
// filename helpers, with a stable fallback when no usable source filename is
// present.
export function excelFileName(narrative) {
  const raw = narrative?.fileName
  const slug = typeof raw === 'string' ? slugify(raw) : ''
  return slug ? `${slug}-variance-narrative.xlsx` : 'variance-narrative.xlsx'
}
