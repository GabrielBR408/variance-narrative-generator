// --- Generate-flow UI state — Phase 9C ------------------------------------
// Deterministic, framework-free view-model helpers for the Generate experience.
// Keeping the readiness / loading / error decisions here (instead of inline in
// the React components) means the rules are pure functions that can be unit
// tested with `node --test` and stay identical wherever they're used.
//
// Boundaries: presentation logic only. No AI/LLM, no network, no persistence,
// no export. These helpers decide what to show; they never compute a narrative.

// Button label per request status. "success"/"failure" let the user retry.
export const GENERATE_LABEL = {
  idle: 'Generate Narrative',
  preparing: 'Preparing…',
  sending: 'Generating…',
  success: 'Regenerate Narrative',
  failure: 'Try Again'
}

// The request is in flight (assembling or awaiting the server) — used to gate
// duplicate submits and show progress.
export function isBusy(status) {
  return status === 'preparing' || status === 'sending'
}

// Is the base report extracted and usable? This is the single gate on whether a
// generate may run. `baseExtraction` is the in-memory extraction record for the
// base file (or undefined/`{status:'pending'}` while it is still being read).
//
// Returns { ready, reason, message } where reason is one of:
//   no-base | extracting | extract-failed | ready
export function extractionReadiness({ hasBase, baseExtraction } = {}) {
  if (!hasBase) {
    return { ready: false, reason: 'no-base', message: 'Add a base variance report to begin.' }
  }

  const status = baseExtraction && baseExtraction.status
  if (!baseExtraction || status === 'pending') {
    return {
      ready: false,
      reason: 'extracting',
      message: 'Reading your base report… Generate will be enabled when it’s ready.'
    }
  }

  if (status !== 'ok') {
    // Surface the extractor's own friendly message when it has one.
    const detail =
      (baseExtraction && baseExtraction.message) ||
      'The base report could not be read. Replace it with a readable file to continue.'
    return { ready: false, reason: 'extract-failed', message: detail }
  }

  return { ready: true, reason: 'ready', message: '' }
}

// Full button view-model the GeneratePanel renders.
export function generateButtonState({ status, readiness } = {}) {
  const busy = isBusy(status)
  const r = readiness || { ready: false }
  return {
    label: GENERATE_LABEL[status] || GENERATE_LABEL.idle,
    busy,
    disabled: busy || !r.ready
  }
}

// --- UX-1: Generate always runs in AI mode --------------------------------
// The Generic/AI toggle is gone — every generation is AI-mode ("cited"). Before
// the first generation in a session the AI disclosure must be acknowledged, so a
// Generate click either opens the disclosure (first time) or generates (once
// acknowledged). The acknowledgment is tracked per session by the caller.
export const AI_LLM_MODE = 'cited'

// Decide what a Generate click should do. Returns one of:
//   'disclose' — show the AI disclosure first (not yet acknowledged)
//   'generate' — proceed with generation in AI mode
//   'noop'     — a request is already in flight
export function generateClickAction({ acknowledged, busy } = {}) {
  if (busy) return 'noop'
  return acknowledged ? 'generate' : 'disclose'
}

// --- Result freshness (Phase 22.2 / 22.3) ---------------------------------
// A generated result reflects the settings AND the files in force WHEN it was
// generated. If the user then changes a threshold, the commentary mode, or the
// uploaded file set, the on-screen result and its exports no longer match the
// current inputs until they regenerate. This pure comparator flags that drift.
//
// Tracked: dollar threshold, percent threshold, commentary mode, and the file
// set (base identity + sorted supporting identities, Phase 22.3). Period scope is
// deliberately NOT tracked — it is applied live at render/export time, so changing
// it never makes a result stale.
//
//   generated, current :
//     { amountThreshold, percentThreshold, commentaryMode, baseKey?, supportingKeys? }
// Returns { stale, changed } where `changed` lists which groups drifted
// ('thresholds', 'commentary', and/or 'files'). Missing inputs → "not stale".
// File drift is only evaluated when the snapshot actually carried file identities,
// so results generated before this tracking existed are never falsely flagged.
function sameKeys(a, b) {
  const x = Array.isArray(a) ? a : []
  const y = Array.isArray(b) ? b : []
  if (x.length !== y.length) return false
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
  return true
}

export function resultFreshness({ generated, current } = {}) {
  if (!generated || !current) return { stale: false, changed: [] }
  const changed = []
  const thresholdsDiffer =
    Number(generated.amountThreshold) !== Number(current.amountThreshold) ||
    Number(generated.percentThreshold) !== Number(current.percentThreshold)
  if (thresholdsDiffer) changed.push('thresholds')
  if (generated.commentaryMode !== current.commentaryMode) changed.push('commentary')

  const tracksFiles = 'baseKey' in generated || 'supportingKeys' in generated
  if (tracksFiles) {
    const filesDiffer =
      generated.baseKey !== current.baseKey ||
      !sameKeys(generated.supportingKeys, current.supportingKeys)
    if (filesDiffer) changed.push('files')
  }

  return { stale: changed.length > 0, changed }
}

// Should a previously generated result be discarded? Phase 22.3: a result that
// no longer has a base report cannot be valid (its source is gone), so the UI
// clears it — removing the stale narrative AND its export availability. Pure so
// the rule is testable; the App applies it in an effect.
export function shouldDiscardResult({ hasBase, hasResult } = {}) {
  return !!hasResult && !hasBase
}

// How many supporting files are still being read. Phase 22.3: used for a
// non-blocking "still processing" warning — Generate stays enabled (base-only is
// valid), but the user is told the in-flight files won't be included yet.
export function pendingSupportingCount(extractions = []) {
  return (Array.isArray(extractions) ? extractions : []).filter((ex) => ex && ex.status === 'pending').length
}

// Whether to show the "supporting files still processing" warning: only when the
// base is ready to generate and at least one supporting file is still extracting.
export function pendingSupportingWarningVisible({ ready, pendingCount } = {}) {
  return !!ready && Number(pendingCount) > 0
}

// Whether the "settings changed since generate" banner should be shown. Pure so
// the visibility rule is testable without a DOM: only after a successful generate
// that produced a result, when that result is stale and not yet dismissed.
export function freshnessBannerVisible({ status, hasResult, stale, dismissed } = {}) {
  return status === 'success' && !!hasResult && !!stale && !dismissed
}

// The single note shown beneath the button, if any. Priority:
//   1. an active error from the last generate attempt (failure)
//   2. a readiness hint (still extracting, or extraction failed)
// "no-base" stays silent — the disabled button is self-explanatory at the start.
// Returns { tone: 'error' | 'info', text } or null.
export function generateHint({ status, message, readiness } = {}) {
  if (status === 'failure' && message) {
    return { tone: 'error', text: message }
  }
  const r = readiness || {}
  if (!r.ready && r.reason && r.reason !== 'no-base') {
    return { tone: r.reason === 'extract-failed' ? 'error' : 'info', text: r.message }
  }
  return null
}
