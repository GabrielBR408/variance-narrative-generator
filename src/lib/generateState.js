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
// Tracked: dollar threshold, percent threshold, commentary mode, the full
// effective STYLE (reportStyle, tone, length, abbreviateDollars,
// dollarReferences — every one shapes the generated output, abbreviation
// included since it is baked in at generate time), and the file set (base
// identity + sorted supporting identities, Phase 22.3). Period scope is
// deliberately NOT tracked — it is applied live at render/export time, so changing
// it never makes a result stale.
//
//   generated, current :
//     { amountThreshold, percentThreshold, commentaryMode,
//       reportStyle?, tone?, length?, abbreviateDollars?, dollarReferences?,
//       baseKey?, supportingKeys? }
// Returns { stale, changed } where `changed` lists which groups drifted
// ('thresholds', 'commentary', 'style', and/or 'files'). Missing inputs → "not
// stale". Style and file drift are only evaluated when the snapshot actually
// carried those identities, so results generated before this tracking existed
// are never falsely flagged.
function sameKeys(a, b) {
  const x = Array.isArray(a) ? a : []
  const y = Array.isArray(b) ? b : []
  if (x.length !== y.length) return false
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
  return true
}

// The Style-panel fields that change generated output (matches
// uiControls.STYLE_ACTIVE_FIELDS keys).
const STYLE_SNAPSHOT_FIELDS = ['reportStyle', 'tone', 'length', 'abbreviateDollars', 'dollarReferences']

export function resultFreshness({ generated, current } = {}) {
  // Missing inputs → "not stale" (no signature: there were no values to compare,
  // and the banner is never visible without a result anyway).
  if (!generated || !current) return { stale: false, changed: [] }
  const changed = []
  const thresholdsDiffer =
    Number(generated.amountThreshold) !== Number(current.amountThreshold) ||
    Number(generated.percentThreshold) !== Number(current.percentThreshold)
  if (thresholdsDiffer) changed.push('thresholds')
  if (generated.commentaryMode !== current.commentaryMode) changed.push('commentary')

  const tracksStyle = STYLE_SNAPSHOT_FIELDS.some((k) => k in generated)
  if (tracksStyle) {
    const styleDiffers = STYLE_SNAPSHOT_FIELDS.some((k) => generated[k] !== current[k])
    if (styleDiffers) changed.push('style')
  }

  const tracksFiles = 'baseKey' in generated || 'supportingKeys' in generated
  if (tracksFiles) {
    const filesDiffer =
      generated.baseKey !== current.baseKey ||
      !sameKeys(generated.supportingKeys, current.supportingKeys)
    if (filesDiffer) changed.push('files')
  }

  // QA fix (pending-extraction staleness): useGenerate's drift effect marks the
  // snapshot when a source file's extraction fingerprint changed AFTER the
  // result was generated (e.g. a supporting file finished extracting). The file
  // KEYS are unchanged in that case, so it surfaces through the same 'files'
  // group — the result no longer reflects the files' actual content.
  if (generated.extractionStale === true && !changed.includes('files')) changed.push('files')

  // QA fix (banner re-arm): a stable serialization of the VALUES this compare
  // ran over — not just the changed GROUP names. ResultPanel keys its dismissal
  // reset on this, so threshold 1000 → 2000 (dismiss) → 3000 re-arms the banner
  // even though the group list ('thresholds') is identical both times. The
  // generate-time fingerprints ride along so each post-dismissal extraction
  // drift also re-arms.
  const signature = JSON.stringify({
    changed,
    current: {
      amountThreshold: current.amountThreshold,
      percentThreshold: current.percentThreshold,
      commentaryMode: current.commentaryMode,
      reportStyle: current.reportStyle,
      tone: current.tone,
      length: current.length,
      abbreviateDollars: current.abbreviateDollars,
      dollarReferences: current.dollarReferences,
      baseKey: current.baseKey,
      supportingKeys: current.supportingKeys
    },
    extractionFingerprints: generated.extractionFingerprints || null
  })

  return { stale: changed.length > 0, changed, signature }
}

// Should a previously generated result be discarded? Phase 22.3: a result that
// no longer has a base report cannot be valid (its source is gone), so the UI
// clears it — removing the stale narrative AND its export availability. Pure so
// the rule is testable; the App applies it in an effect.
export function shouldDiscardResult({ hasBase, hasResult } = {}) {
  return !!hasResult && !hasBase
}

// Should a lingering failure be cleared? A failure message describes the file
// set it failed ON — once the user changes that file set (swaps in a good file,
// removes the bad one) the old alert would wrongly imply the NEW files are also
// bad, so the failure status/message reset to idle. Pure so the rule is
// testable; the App applies it in an effect keyed on the file-set identity.
export function shouldClearFailure({ status, filesChanged } = {}) {
  return status === 'failure' && !!filesChanged
}

// --- Request identity (QA fix: mid-generation supersession) ----------------
// A /generate response must only render if it still describes what is on
// screen. Two things can invalidate an in-flight request: a NEWER request
// started (its response should win), or the uploaded file set changed while
// the request was in flight (the response would render the OLD file's
// narrative as "Generation complete" for the NEW list). Both checks are pure
// so the discard rule is testable; useGenerate stamps each request with a
// monotonic id + the file-set signature it was built from and asks this at
// every resolve/reject path.

// Canonical identity of a file set (base + sorted supporting keys) — the same
// shape App keys its stale-failure reset on. Order-insensitive for supporting
// files, so a mere reorder never reads as a different set.
export function fileSetSignature({ baseKey, supportingKeys } = {}) {
  const supporting = Array.isArray(supportingKeys) ? [...supportingKeys].sort() : []
  return [baseKey || '', ...supporting].join('|')
}

// True when a resolved response may still be applied to the UI: no newer
// request has started AND the on-screen file set still matches the one the
// request was assembled from.
export function shouldApplyGenerateResponse({
  requestId,
  latestRequestId,
  requestFileSetKey,
  currentFileSetKey
} = {}) {
  return requestId === latestRequestId && requestFileSetKey === currentFileSetKey
}

// --- Honest local fallback (QA fix: silent client fallback) ----------------
// The in-browser fallback is legitimate on a static host (the endpoint is
// genuinely absent — 404/405, or a 200 that served the SPA shell). But when it
// ran because the fetch itself REJECTED (network failure, server unreachable),
// presenting the local narrative as an unqualified "Generation complete" hides
// that the AI path never ran. This pure policy yields the plain-language
// notice for exactly that case, and null for every legitimate-fallback or
// server path, so the message and its trigger are testable without a browser.
export const LOCAL_FALLBACK_NOTICE =
  'Narratives were generated locally without AI commentary because the server could not be reached. ' +
  'Style settings beyond dollar formatting may not apply.'

export function localFallbackNotice({ usedFallback, fetchRejected } = {}) {
  return usedFallback && fetchRejected ? LOCAL_FALLBACK_NOTICE : null
}

// --- Extraction fingerprints (QA fix: pending-extraction staleness) --------
// A result generated while a supporting file was still extracting shipped with
// that file's EMPTY normalized data. When the extraction completes seconds
// later, the file KEYS have not changed — so a key-only freshness compare sees
// nothing. These fingerprints capture what the generation actually consumed
// (extraction status + normalized row count), so a file finishing (or
// re-extracting differently) after generation marks the result stale.

// Cheap, deterministic fingerprint of one extraction record. 'missing' when the
// record does not exist (file not yet registered / removed).
export function extractionFingerprint(ex) {
  if (!ex) return 'missing'
  const rows =
    ex.normalized && Array.isArray(ex.normalized.rows) ? ex.normalized.rows.length : 0
  return `${ex.status || 'unknown'}::${rows}`
}

// Fingerprint map for a result's source file set (base + supporting keys),
// read from the extraction map keyed by fileKey (fileId === fileKey).
export function sourceExtractionFingerprints({ baseKey, supportingKeys, extractions } = {}) {
  const map = {}
  const keys = [baseKey, ...(Array.isArray(supportingKeys) ? supportingKeys : [])].filter(Boolean)
  for (const key of keys) map[key] = extractionFingerprint(extractions ? extractions[key] : null)
  return map
}

// True when any file's fingerprint differs between the generate-time snapshot
// and the current extraction state (including keys present on only one side).
export function extractionFingerprintsDrifted(generated, current) {
  const g = generated || {}
  const c = current || {}
  const keys = new Set([...Object.keys(g), ...Object.keys(c)])
  for (const key of keys) if (g[key] !== c[key]) return true
  return false
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
