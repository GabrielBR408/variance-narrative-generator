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

// --- Result freshness (Phase 22.2) ----------------------------------------
// A generated result reflects the settings in force WHEN it was generated. If the
// user then changes a threshold or the commentary mode, the on-screen result and
// its exports no longer match the current settings until they regenerate. This
// pure comparator flags that drift.
//
// Tracked: dollar threshold, percent threshold, commentary mode. Period scope is
// deliberately NOT tracked — it is applied live at render/export time, so changing
// it never makes a result stale.
//
//   generated, current : { amountThreshold, percentThreshold, commentaryMode }
// Returns { stale, changed } where `changed` lists which groups drifted
// ('thresholds' and/or 'commentary'). Missing inputs are treated as "not stale".
export function resultFreshness({ generated, current } = {}) {
  if (!generated || !current) return { stale: false, changed: [] }
  const changed = []
  const thresholdsDiffer =
    Number(generated.amountThreshold) !== Number(current.amountThreshold) ||
    Number(generated.percentThreshold) !== Number(current.percentThreshold)
  if (thresholdsDiffer) changed.push('thresholds')
  if (generated.commentaryMode !== current.commentaryMode) changed.push('commentary')
  return { stale: changed.length > 0, changed }
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
