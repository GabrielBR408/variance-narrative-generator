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
import { checkBaseIsVarianceReport } from './variance/baseGate.js'

// Build the same { success, jobId, filesReceived, settingsReceived, files,
// extraction, variance, narrative } shape server/generate.js returns. Mirrors
// the server's pre-generate base gate so the static-host fallback fails the same
// way (with the same message) when a non-variance file is in the base slot.
//   baseExtraction : the slim normalized extraction for the base report
//   files          : [{ name, size, type, role }] metadata (base + supporting)
//   thresholds     : { amount, percent } (already resolved from settings)
export function clientGenerate({ baseExtraction, files = [], thresholds, settingsReceived = true } = {}) {
  const gate = checkBaseIsVarianceReport(baseExtraction && baseExtraction.normalized)
  if (!gate.ok) {
    return { success: false, error: gate.message, errorCode: gate.reason }
  }

  const { extraction, variance, narrative } = runPipeline(baseExtraction, { thresholds })
  return {
    success: true,
    // Distinguish a locally computed job from a server-minted one.
    jobId: 'LOCAL-' + String(Date.now()).slice(-6),
    filesReceived: Array.isArray(files) ? files.length : 0,
    settingsReceived: !!settingsReceived,
    files: Array.isArray(files) ? files : [],
    extraction,
    variance,
    narrative
  }
}
