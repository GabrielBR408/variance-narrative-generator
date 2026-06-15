// --- Generate pipeline — Phase 9B -----------------------------------------
// The deterministic "generate flow" core: it takes ONE normalized extraction
// (the Phase 7 output the browser already produced) and runs it through the
// existing engines to produce the structured response the generate endpoint
// returns:
//
//   normalized extraction → compute variance → generate narrative
//     → { extraction, variance, narrative }
//
// Why the extraction is an input, not something this module produces: extraction
// (PDF/spreadsheet/DOCX parsing) is deliberately browser-first — the PDF reader
// runs in the browser's pdf.js worker and cannot run in Node. This module
// therefore imports ONLY the pure, environment-agnostic variance and narrative
// engines, so it runs identically in the browser and on the Node server.
//
// Boundaries (Phase 9B): deterministic only. NO AI/LLM, NO export, NO
// persistence, NO network, NO new parsing. It never invents values — every
// figure it returns is computed by the variance engine from the extraction it
// was handed, and every narrative sentence traces back to a source row.

import { computeVariance } from './variance/index.js'
import { generateNarrative } from './narrative/index.js'
import { DEFAULT_THRESHOLDS } from './variance/thresholds.js'

// A faithful, compact view of the normalized extraction that fed the pipeline.
// We pass the rows/columns through verbatim so a consumer (or a test) can trace
// every computed figure back to its exact source cell — nothing is added.
export function summarizeExtraction(extraction) {
  const normalized = (extraction && extraction.normalized) || {}
  const rows = Array.isArray(normalized.rows) ? normalized.rows : []
  return {
    fileId: extraction?.fileId ?? null,
    fileName: extraction?.fileName ?? null,
    status: extraction?.status ?? 'unknown',
    confidence: Number.isFinite(extraction?.confidence) ? extraction.confidence : 0,
    classification: extraction?.classification?.type ?? null,
    columns: Array.isArray(normalized.columns) ? normalized.columns : [],
    rowCount: rows.length,
    rows
  }
}

// Run the deterministic pipeline for one normalized extraction.
// `thresholds` is optional; the central Phase 8 defaults apply when omitted.
// Never throws: the variance engine returns an honest empty result for
// non-tabular / unreadable input, and the narrative engine yields zero periods
// for an empty variance result — so an invalid upload degrades cleanly instead
// of fabricating output.
export function runPipeline(extraction, options = {}) {
  const thresholds = normalizeThresholds(options.thresholds)
  const variance = computeVariance(extraction, thresholds)
  const narrative = generateNarrative(variance, { thresholds })
  return {
    extraction: summarizeExtraction(extraction),
    variance,
    narrative
  }
}

// Accept caller-supplied thresholds only when both are finite, non-negative
// numbers; otherwise fall back to the central defaults. Keeps the engine
// deterministic and guards against malformed settings from the request.
export function normalizeThresholds(thresholds) {
  const amount = Number(thresholds?.amount)
  const percent = Number(thresholds?.percent)
  if (Number.isFinite(amount) && amount >= 0 && Number.isFinite(percent) && percent >= 0) {
    return { amount, percent }
  }
  return DEFAULT_THRESHOLDS
}
