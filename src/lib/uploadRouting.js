// --- Unified upload routing — Phase C ---------------------------------------
// One drop zone now accepts every file at once. This module decides which file
// in a freshly dropped/selected batch is the BASE variance report and which are
// SUPPORTING files, so the rest of the app can keep its two-slot model.
//
// It makes that decision using ONLY the existing filename classifier
// (src/lib/classify.js) — it does not open, parse, or re-classify anything, and
// it deliberately does not touch the classifier's rules. The classifier already
// recognises a variance report from its name ('Existing Variance Report'); that
// is the single signal we route on. Everything here is pure and deterministic:
// same inputs ⇒ same routing, so it can be read, tested, and audited by hand.

import { classifyFile, FALLBACK_TYPE } from './classify.js'
import { fileKey } from './fileKey.js'

// The one filename-classification type that names a base variance report.
const BASE_TYPE = 'Existing Variance Report'

// Best-guess by filename alone (no upload role, no contents). Memo-friendly:
// callers may pass the type straight through if they already have it.
function typeOf(file) {
  return classifyFile({ name: file.name }).type
}

// Does this file look like a base variance report from its name?
export function isBaseCandidate(file) {
  return typeOf(file) === BASE_TYPE
}

// Pick the file in `incoming` that should occupy the base slot, or null to keep
// whatever base is already there. Selection priority, strongest first:
//   1. A file the classifier names a variance report ('Existing Variance Report')
//      — the clearest base signal. Highest confidence wins; ties keep drop order.
//   2. Only when there is NO base yet: a file the classifier could not place
//      (generic 'Supporting Document') — an unlabelled comparative statement is
//      far more likely to be the base than a clearly-named GL/Budget/etc.
//   3. Only when there is NO base yet: the first file, so a base always lands.
// Once a base exists, an ambiguous batch never displaces it (rule 4): only an
// explicit variance-named file (priority 1) replaces a base already in place.
function selectBase(incoming, hasBase) {
  const named = incoming
    .map((file) => ({ file, c: classifyFile({ name: file.name }) }))
    .filter(({ c }) => c.type === BASE_TYPE)
  if (named.length) {
    return named.reduce((best, cur) => (cur.c.confidence > best.c.confidence ? cur : best)).file
  }
  if (hasBase) return null
  const generic = incoming.find((file) => typeOf(file) === FALLBACK_TYPE)
  return generic || incoming[0] || null
}

// Route a freshly dropped/selected batch. Pure — returns the next upload state
// and a human-readable notice; never mutates its inputs.
//
//   { incoming: File[], currentBase: File|null, currentSupporting: File[] }
// ⇒ { base, supporting, baseReplaced, addedSupporting, notice }
//
// `base` is the file that should occupy the base slot afterwards (may be the
// unchanged current base). `supporting` is the FULL next supporting list
// (current + newly routed). A replaced base is dropped, not demoted (rule 4).
export function routeUpload({ incoming = [], currentBase = null, currentSupporting = [] } = {}) {
  const files = Array.from(incoming).filter(Boolean)
  if (!files.length) {
    return {
      base: currentBase,
      supporting: currentSupporting,
      baseReplaced: false,
      addedSupporting: 0,
      notice: ''
    }
  }

  const picked = selectBase(files, !!currentBase)
  let base = picked || currentBase
  // A replacement means a DIFFERENT file took the base slot; re-dropping the
  // same base (same fileKey) just refreshes it in place, without a notice.
  const baseReplaced = !!picked && !!currentBase && fileKey(picked) !== fileKey(currentBase)
  const baseAssignedFresh = !!picked && !currentBase

  // Re-dropping the file already in the base slot refreshes that slot — it must
  // never land in supporting alongside itself.
  const baseKey = base ? fileKey(base) : null
  if (!picked && baseKey) {
    const redropped = files.find((f) => fileKey(f) === baseKey)
    if (redropped) base = redropped
  }

  // Everything in the batch that did not become (or refresh) the base is
  // supporting. Dedupe by fileKey: same name+size+mtime ⇒ same file this
  // session, so a re-dropped file REPLACES its existing entry (keeping its
  // position) instead of duplicating it.
  const incomingSupporting = files.filter((f) => f !== picked && fileKey(f) !== baseKey)
  const byKey = new Map(currentSupporting.map((f) => [fileKey(f), f]))
  let added = 0
  for (const f of incomingSupporting) {
    const k = fileKey(f)
    if (!byKey.has(k)) added++
    byKey.set(k, f)
  }
  // A newly promoted base never lingers in supporting (e.g. a variance-named
  // re-drop of a file that previously landed there).
  if (baseKey) byKey.delete(baseKey)
  const supporting = [...byKey.values()]

  const parts = []
  if (baseReplaced) parts.push(`Replaced the base variance report — now using "${picked.name}".`)
  else if (baseAssignedFresh) parts.push(`Identified "${picked.name}" as the base variance report.`)
  if (added) {
    parts.push(`Added ${added} supporting file${added === 1 ? '' : 's'}.`)
  }

  return {
    base,
    supporting,
    baseReplaced,
    addedSupporting: added,
    notice: parts.join(' ')
  }
}
