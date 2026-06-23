// --- Browser-side generate fallback — static hosting ----------------------
// The app normally POSTs to the /generate endpoint (mounted in Vite dev/preview
// middleware, see vite.config.js → server/generate.js). On a static host such as
// GitHub Pages there is no server, so this computes the SAME response in the
// browser using the SAME pure pipeline the server runs. It is a drop-in for the
// server's JSON body, so the rest of the generate flow (enrichment, diagnostic,
// result + exports) is identical whether the round-trip hit a server or not.
//
// Pure and deterministic: it only runs the existing variance + narrative engines
// over the base report's already-computed extraction. No network, no parsing, no
// AI/LLM, no persistence. Supporting files are NOT variance-computed here (they
// only enrich the base narrative downstream), exactly like the server path.

import { runPipeline } from './pipeline.js'
import { evaluateBaseRouting } from './variance/baseGate.js'

// Build the same { success, jobId, filesReceived, settingsReceived, files,
// extraction, variance, narrative } shape server/generate.js returns. Mirrors
// the server's pre-generate base routing decision so the static-host fallback
// behaves identically: a misrouted base auto-corrects when exactly one
// supporting file is structurally a variance report; otherwise it stops with
// the same smarter, file-naming message the server returns.
//   baseExtraction        : the slim normalized extraction for the base report
//   supportingExtractions : slim normalized extractions for the supporting files
//   files                 : [{ name, size, type, role }] metadata (base + supporting)
//   thresholds            : { amount, percent } (already resolved from settings)
export function clientGenerate({ baseExtraction, supportingExtractions = [], files = [], thresholds, settingsReceived = true } = {}) {
  const gate = evaluateBaseRouting({ base: baseExtraction, supporting: supportingExtractions })
  if (gate.outcome === 'stop_no_candidate' || gate.outcome === 'stop_multiple_candidates') {
    return { success: false, error: gate.message, errorCode: gate.reason }
  }

  let baseForPipeline = baseExtraction
  let filesOut = Array.isArray(files) ? files : []
  let correction = null
  if (gate.outcome === 'auto_correct') {
    baseForPipeline = gate.base
    const baseFileName = (gate.base && gate.base.fileName) || ''
    filesOut = filesOut.map((f) => {
      if (!f || typeof f !== 'object') return f
      if (f.name === baseFileName) return { ...f, role: 'baseReport' }
      return { ...f, role: 'supportingFile' }
    })
    correction = {
      corrected: true,
      notice: gate.correction.notice,
      baseFileId: gate.correction.baseFileId,
      supportingFileIds: gate.correction.supportingFileIds
    }
  }

  const { extraction, variance, narrative } = runPipeline(baseForPipeline, { thresholds })
  return {
    success: true,
    // Distinguish a locally computed job from a server-minted one.
    jobId: 'LOCAL-' + String(Date.now()).slice(-6),
    filesReceived: filesOut.length,
    settingsReceived: !!settingsReceived,
    files: filesOut,
    extraction,
    variance,
    narrative,
    correction
  }
}
