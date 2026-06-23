import { AI_LLM_MODE } from '../lib/generateState.js'
import { enrichNarrative } from '../lib/enrich/index.js'
import { clientGenerate } from '../lib/clientGenerate.js'
import { commentaryModeFromStyle } from '../lib/enrich/commentaryMode.js'
import { applyDollarAbbreviation } from '../lib/narrative/dollarAbbrev.js'
import { enrichmentDiagnostic } from '../lib/enrichmentDiagnostic.js'
import { enrichmentStatus } from '../lib/enrichmentStatus.js'
import { backupNotice } from '../lib/backupNotice.js'
import { fileKey } from '../lib/fileKey.js'

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
  async function generate() {
    if (busy) return // prevent duplicate submits

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
    try {
      // Try the real /generate endpoint (present in dev/preview and any server
      // deploy). On a static host (e.g., GitHub Pages) there is no endpoint, so
      // the request yields no usable JSON — fall back to computing the SAME
      // response in-browser with the same pure pipeline. A server that responds
      // with a structured error is still authoritative (surfaced below).
      let data = null
      try {
        const res = await fetch('/api/generate', { method: 'POST', body: form })
        data = await res.json()
      } catch {
        data = clientGenerate({
          baseExtraction,
          files: clientFiles,
          thresholds: previewThresholds,
          settingsReceived: Boolean(style && variance)
        })
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
      const enriched = enrichNarrative(data.narrative, { supporting: supportingExtractions, mode })

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
        // Phase 22.2: snapshot the settings this result was generated with, so the
        // UI can warn when the live settings drift from it (period scope excluded —
        // it is applied live at render/export time, so it never makes a result stale).
        settings: {
          amountThreshold: previewThresholds.amount,
          percentThreshold: previewThresholds.percent,
          commentaryMode: mode
        },
        // Phase 22.3: snapshot the file set too (base + sorted supporting), so the
        // same freshness banner fires when files are added, removed, or replaced.
        source: {
          baseKey: fileKey(baseReport),
          supportingKeys: supportingFiles.map(fileKey).sort()
        }
      })
      setStatus('success')
    } catch (err) {
      setStatus('failure')
      setMessage(err.message || 'Something went wrong. Try again.')
    }
  }

  return generate
}
