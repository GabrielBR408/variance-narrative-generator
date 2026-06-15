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
