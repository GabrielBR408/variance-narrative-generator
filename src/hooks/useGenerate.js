import { useEffect, useRef } from 'react'
import {
  AI_LLM_MODE,
  fileSetSignature,
  shouldApplyGenerateResponse,
  localFallbackNotice,
  sourceExtractionFingerprints,
  extractionFingerprintsDrifted
} from '../lib/generateState.js'
import { enrichNarrative } from '../lib/enrich/index.js'
import { clientGenerate } from '../lib/clientGenerate.js'
import { commentaryModeFromStyle } from '../lib/enrich/commentaryMode.js'
import { applyDollarAbbreviation } from '../lib/narrative/dollarAbbrev.js'
import { enrichmentDiagnostic } from '../lib/enrichmentDiagnostic.js'
import { enrichmentStatus } from '../lib/enrichmentStatus.js'
import { backupNotice } from '../lib/backupNotice.js'
import { fileKey } from '../lib/fileKey.js'
import { track } from '../lib/track.js'

// Should a /generate response hand off to the in-browser fallback? Only when
// the endpoint is genuinely absent: the fetch itself rejected (no server /
// network failure, res is null) or the host answered 404/405 (a static host
// with no such route). Any other non-ok status came from a REAL server that
// failed — falling back there would mask the failure as a quiet "success" with
// a basic LOCAL- narrative. Pure so the policy is testable without a browser.
export function shouldClientFallback(res) {
  if (!res) return true
  return res.status === 404 || res.status === 405
}

// Actionable message for a server that answered but could not complete the
// generation (non-ok, non-404/405, and no structured error body to surface).
export function serverFailureMessage(status) {
  if (status === 413) {
    return 'The uploaded files are too large for the server to accept. Remove or shrink a file and try again.'
  }
  return `The server could not complete the generation (HTTP ${status}). Try again in a moment.`
}

// Abort a stalled /api/generate call after this long, mirroring the OCR
// client's guard (src/lib/ocr/ocrClient.js OCR_FETCH_TIMEOUT_MS), so a hung
// endpoint can never leave the Generate spinner running forever. The abort is
// routed into the same friendly failure-message path as any other failure.
export const GENERATE_FETCH_TIMEOUT_MS = 90000
export const GENERATE_TIMEOUT_MESSAGE =
  'The server took too long to respond. Check your connection and try again in a moment.'

// Compact, faithful view of a browser extraction to ship to /generate. We send
// only the normalized shape the variance engine reads — never the raw text or
// parser internals. Returns null when the file hasn't been extracted yet.
function slimExtraction(ex) {
  if (!ex) return null
  return {
    fileId: ex.fileId,
    fileName: ex.fileName,
    status: ex.status,
    confidence: ex.confidence,
    classification: ex.classification ? { type: ex.classification.type } : null,
    normalized: ex.normalized || { rows: [], columns: [], accounts: [], dates: [], values: [] }
  }
}

// The Generate flow, extracted verbatim from App(). Owns no state of its own —
// it reads the inputs App passes in and drives App's status/result/message
// setters, so the shared generation state stays in App. Returns the async
// `generate` function the click/disclosure handlers invoke.
export function useGenerate({
  baseReport,
  supportingFiles,
  style,
  variance,
  extractions,
  previewThresholds,
  readiness,
  busy,
  setStatus,
  setResult,
  setMessage
}) {
  // QA fix (double-activation): `busy` is render-scoped state, so two
  // activations delivered in one task (key auto-repeat, assistive tech) both
  // see busy === false and would fire two POSTs. This ref is set synchronously
  // at the top of generate() and cleared in `finally`, so the second activation
  // is a guaranteed no-op regardless of render timing.
  const inFlightRef = useRef(false)

  // QA fix (mid-generation supersession): each generate() call takes the next
  // id from this monotonic counter and remembers the file-set signature it was
  // built from. The latest-file-set ref is refreshed on every render, so an
  // in-flight request can ask at resolve/reject time whether the files it
  // describes are still the ones on screen (see shouldApplyGenerateResponse).
  const requestSeqRef = useRef(0)
  const currentFileSetRef = useRef('')
  currentFileSetRef.current = fileSetSignature({
    baseKey: baseReport ? fileKey(baseReport) : '',
    supportingKeys: supportingFiles.map(fileKey)
  })

  // QA fix (pending-extraction staleness): a result generated while a source
  // file was still extracting consumed that file's EMPTY normalized data. Its
  // snapshot carries per-file extraction fingerprints (status + row count);
  // when the live extraction map drifts from them — e.g. a supporting file
  // finishes seconds after generation — the snapshot is marked stale so the
  // freshness banner fires even though the file KEYS never changed. Functional
  // setResult keeps this reading the latest result without owning any state.
  useEffect(() => {
    setResult((prev) => {
      if (!prev || !prev.source || !prev.source.extractionFingerprints) return prev
      const current = sourceExtractionFingerprints({
        baseKey: prev.source.baseKey,
        supportingKeys: prev.source.supportingKeys,
        extractions
      })
      if (!extractionFingerprintsDrifted(prev.source.extractionFingerprints, current)) return prev
      return {
        ...prev,
        source: { ...prev.source, extractionFingerprints: current, extractionStale: true }
      }
    })
  }, [extractions, setResult])

  async function generate() {
    if (busy || inFlightRef.current) return // prevent duplicate submits

    // Taken synchronously — a second activation in the SAME task sees it set.
    inFlightRef.current = true

    // Identity of THIS request: its sequence number and the file set it will be
    // assembled from. A resolved/rejected response is applied only while both
    // still match the latest state (no newer request, same files on screen).
    const requestId = ++requestSeqRef.current
    const requestFileSet = currentFileSetRef.current
    const superseded = () =>
      !shouldApplyGenerateResponse({
        requestId,
        latestRequestId: requestSeqRef.current,
        requestFileSetKey: requestFileSet,
        currentFileSetKey: currentFileSetRef.current
      })

    try {
      // Readiness gate (Phase 9C): no base, still extracting, or extraction failed.
      // The button is already disabled in these states; this guards programmatic
      // or race-y calls and surfaces the same friendly explanation.
      if (!readiness.ready) {
        setStatus('failure')
        setResult(null)
        setMessage(readiness.message)
        return
      }

      // Preparing: assemble one multipart request carrying the actual file
      // bytes. No interpretation, no extraction, no validation beyond the
      // required base file above.
      setStatus('preparing')
      setMessage('')
      setResult(null)

      const form = new FormData()
      form.append('baseReport', baseReport) // real File object
      supportingFiles.forEach((f) => form.append('supportingFiles', f)) // real File objects
      form.append('style', JSON.stringify(style))
      form.append('variance', JSON.stringify(variance))
      form.append('llmMode', AI_LLM_MODE)

      // Phase 9B: extraction is browser-first, so the normalized result the
      // browser already computed travels with the request. The server runs the
      // deterministic variance + narrative engines on it — no re-parsing.
      const baseExtraction = slimExtraction(extractions[fileKey(baseReport)])
      const supportingExtractions = supportingFiles
        .map((f) => slimExtraction(extractions[fileKey(f)]))
        .filter(Boolean)
      form.append(
        'extractions',
        JSON.stringify({ base: baseExtraction, supporting: supportingExtractions })
      )

      // Compact file metadata for the static fallback's response (mirrors what the
      // server reports back as `files`).
      const clientFiles = [
        { name: baseReport.name, size: baseReport.size, type: baseReport.type || '', role: 'baseReport' },
        ...supportingFiles.map((f) => ({ name: f.name, size: f.size, type: f.type || '', role: 'supportingFile' }))
      ]

      // Sending. Do not set Content-Type — the browser adds the multipart
      // boundary automatically.
      setStatus('sending')

      // Try the real /generate endpoint (present in dev/preview and any server
      // deploy). On a static host (e.g., GitHub Pages) there is no endpoint —
      // the fetch rejects or the host answers 404/405 — so fall back to
      // computing the SAME response in-browser with the same pure pipeline.
      // Any OTHER non-ok status (413 payload too large, 5xx) is a real server
      // failing and is surfaced as a failure, never silently downgraded to the
      // basic local narrative. A server that responds with a structured error
      // is still authoritative (surfaced below).
      const runClientFallback = () =>
        clientGenerate({
          baseExtraction,
          supportingExtractions,
          files: clientFiles,
          thresholds: previewThresholds,
          settingsReceived: Boolean(style && variance)
        })

      // QA fix (no timeout): abort a stalled request after the same 90 s the
      // OCR client uses, so a hung endpoint surfaces as a friendly failure
      // instead of an eternal spinner. An abort is a REAL failure (the server
      // exists but stalled) — it must never downgrade to the local fallback.
      let res = null
      let fetchRejected = false
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), GENERATE_FETCH_TIMEOUT_MS)
      try {
        res = await fetch('/api/generate', { method: 'POST', body: form, signal: controller.signal })
      } catch (err) {
        if (err && err.name === 'AbortError') throw new Error(GENERATE_TIMEOUT_MESSAGE)
        res = null // network error / no server at all
        fetchRejected = true // remembered so the local fallback is labeled honestly
      } finally {
        clearTimeout(timer)
      }

      let data = null
      let usedFallback = false
      if (shouldClientFallback(res)) {
        data = runClientFallback()
        usedFallback = true
      } else if (!res.ok) {
        // The server answered but failed. Prefer its own structured error
        // message; a non-JSON body (HTML 500 page, host-level 413) gets an
        // actionable status-derived message instead.
        let body = null
        try {
          body = await res.json()
        } catch {
          body = null
        }
        throw new Error((body && body.error) || serverFailureMessage(res.status))
      } else {
        try {
          data = await res.json()
        } catch {
          // 200 but not JSON: a static host served the SPA shell for the POST.
          data = runClientFallback()
          usedFallback = true
        }
      }

      if (!data || data.success !== true || !data.narrative) {
        throw new Error((data && data.error) || 'Generation could not be completed. Try again.')
      }

      // Phase 15: enrich the server's base-only narrative with deterministic
      // evidence from the supporting files (which the browser already extracted).
      // With no supporting files or no confident match, this is a no-op and the
      // narrative is byte-identical to the server's.
      // Phase 21.3/21.4: commentary mode (Detailed is the default; Conservative
      // is still selectable). The chosen mode flows into the generated result
      // and the exports (which consume this enriched narrative).
      const mode = commentaryModeFromStyle(style)

      // Generate-time role correction (server-side, Option A): if the server
      // re-routed which file is the base, enrich with the CORRECTED supporting
      // set (so the demoted file is now mined as supporting and the promoted base
      // is not). fileId === fileKey, so the corrected ids resolve straight out of
      // the extraction map. With no correction this is the original supporting set
      // and behavior is unchanged.
      const correction = data.correction && data.correction.corrected ? data.correction : null
      const enrichSupporting = correction
        ? correction.supportingFileIds.map((id) => slimExtraction(extractions[id])).filter(Boolean)
        : supportingExtractions
      const enriched = enrichNarrative(data.narrative, { supporting: enrichSupporting, mode })

      // Phase 23: "Abbreviate Dollar Values" is a cosmetic pass over the finished
      // narrative text. Default Off → identity (same reference), so the
      // deterministic output is byte-identical to before. On → "$5,000" → "$5K".
      const narrative = applyDollarAbbreviation(enriched, !!style.abbreviateDollars)

      // UI-only enrichment diagnostic (deterministic; reads counts only, never
      // amounts/rows). Tells the user whether GL enrichment actually ran.
      const diagnostic = enrichmentDiagnostic({
        extractions: supportingExtractions,
        narratives: [narrative]
      })

      // Fix A: per-run enrichment status. Reads the server's fallback reason
      // (absent on the static-host clientGenerate path → normalizes to the
      // 'api_error' catch-all) plus the per-line llmEnriched flags. Surface-only;
      // never alters the narrative.
      const enrichment = enrichmentStatus({ narrative, reason: data.enrichmentReason })

      // Input-guidance phase: a short, non-alarming notice recommending a
      // supporting input that was not provided and would have strengthened the
      // commentary. Presence/file-type detection only; null when the app made do.
      const files = Array.isArray(data.files) ? data.files : []
      const backup = backupNotice({ narrative, variance: data.variance, files })

      // QA fix (silent local fallback): when the in-browser fallback ran
      // because the fetch REJECTED (server unreachable) rather than because
      // the endpoint is genuinely absent (static-host 404/405 or SPA shell),
      // the completion carries a plain notice saying so. null otherwise.
      const notice = localFallbackNotice({ usedFallback, fetchRejected })

      // QA fix (mid-generation supersession): if the user replaced the file
      // set while this request was in flight — or a newer request started —
      // this response describes files that are no longer on screen. Discard it
      // silently (back to idle) instead of rendering the OLD files' narrative
      // as "Generation complete" for the NEW list. (Removing the base entirely
      // is separately handled by shouldDiscardResult in App.)
      if (superseded()) {
        setStatus('idle')
        setMessage('')
        return
      }

      setResult({
        jobId: data.jobId,
        filesReceived: data.filesReceived,
        settingsReceived: data.settingsReceived,
        files: Array.isArray(data.files) ? data.files : [],
        extraction: data.extraction,
        variance: data.variance,
        narrative,
        diagnostic,
        enrichment,
        backup,
        // Generate-time role correction notice (Option A). null when nothing was
        // re-routed; ResultPanel and the Excel export render it when present.
        correction: correction ? { notice: correction.notice } : null,
        // Honest-fallback notice (QA fix). null on every server / static-host
        // path; ResultPanel renders it alongside the enrichment status line.
        notice,
        // Phase 22.2: snapshot the settings this result was generated with, so the
        // UI can warn when the live settings drift from it (period scope excluded —
        // it is applied live at render/export time, so it never makes a result stale).
        // The full effective style rides along: every Style-panel field changes the
        // generated output (abbreviation is baked in just above), so drifting any of
        // them must trip the same freshness banner.
        settings: {
          amountThreshold: previewThresholds.amount,
          percentThreshold: previewThresholds.percent,
          commentaryMode: mode,
          reportStyle: style.reportStyle,
          tone: style.tone,
          length: style.length,
          abbreviateDollars: !!style.abbreviateDollars,
          dollarReferences: style.dollarReferences
        },
        // Phase 22.3: snapshot the file set too (base + sorted supporting), so the
        // same freshness banner fires when files are added, removed, or replaced.
        // On a role correction, snapshot the CORRECTED routing so freshness stays
        // consistent with what was actually generated. QA fix: each file's
        // extraction fingerprint (status + row count, read from the SAME
        // click-time extraction map this request shipped) rides along, so a
        // file that finishes extracting after generation marks the result
        // stale even though its key never changed (see the drift effect above).
        source: (() => {
          const baseKey = correction ? correction.baseFileId : fileKey(baseReport)
          const supportingKeys = (
            correction ? [...correction.supportingFileIds] : supportingFiles.map(fileKey)
          ).sort()
          return {
            baseKey,
            supportingKeys,
            extractionFingerprints: sourceExtractionFingerprints({ baseKey, supportingKeys, extractions })
          }
        })()
      })
      setStatus('success')

      // Analytics: rows = total data rows the variance engine reviewed;
      // flagged = rows that crossed the user's dollar/percent threshold (the
      // engine's only "this is a variance worth narrating" signal — see
      // src/lib/variance/summarize.js's highVarianceCount, the same count the
      // live VariancePreview and generated narrative are both built from).
      const summary = data.variance && data.variance.summary
      track('vng', 'narrative_generated', {
        rows: (summary && summary.totalRowsReviewed) || 0,
        flagged: (summary && summary.highVarianceCount) || 0
      })
    } catch (err) {
      // QA fix (mid-generation supersession): a rejection for a request whose
      // file set was replaced mid-flight describes files no longer on screen —
      // discard it silently too, rather than alarming about the wrong files.
      if (superseded()) {
        setStatus('idle')
        setMessage('')
        return
      }
      setStatus('failure')
      const failMessage = err.message || 'Something went wrong. Try again.'
      setMessage(failMessage)
      track('vng', 'generate_failed', { reason: failMessage.slice(0, 200) })
    } finally {
      // QA fix (double-activation): always release the synchronous in-flight
      // lock, whatever path this call took.
      inFlightRef.current = false
    }
  }

  return generate
}
