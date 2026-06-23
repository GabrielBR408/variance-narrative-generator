// --- POST /generate — generate flow handler -------------------------------
// Phase 9B. Receives multipart/form-data with the actual file bytes AND the
// browser's already-normalized extraction(s), runs the deterministic pipeline
// (compute variance → generate narrative), and returns a structured response:
//
//   { success, jobId, filesReceived, settingsReceived, files,
//     extraction, variance, narrative }
//
// Why extraction arrives from the client instead of being parsed here: the
// extraction layer is browser-first (the PDF reader runs in the browser's pdf.js
// worker and can't run in Node), so the browser extracts and ships the
// normalized result; this endpoint runs only the pure, deterministic variance +
// narrative engines on it. See src/lib/pipeline.js.
//
// This handler is framework-agnostic: it takes Node's (req, res) and works
// today inside the Vite dev/preview middleware, and can be mounted on a plain
// Node HTTP server (or an Express route) in production without changes.
//
// Boundaries (Phase 9B): deterministic only. NO AI/LLM, NO export, NO
// persistence, NO deployment. File bytes still stream through Busboy and are
// counted then discarded — nothing is buffered to completion, written to disk,
// uploaded, logged, or kept between requests. The extraction payload likewise
// lives only for the life of the request.
import Busboy from 'busboy'
import { runPipeline } from '../src/lib/pipeline.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'
import { commentaryModeFromStyle } from '../src/lib/enrich/commentaryMode.js'
import { LLM_ENABLED, checkIpLimit, checkGlobalLimit, enrichWithLLM } from './llm.js'
import { validateFileRoles } from './validateRoles.js'

// Reasonable safety limits. Files are never stored, so these only guard memory
// and request time, not storage.
const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25 MB per file
const MAX_FILES = 25

const ALLOWED_EXT = new Set(['pdf', 'xlsx', 'xls', 'csv', 'docx'])
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls (and some CSV exports)
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // docx
])

function extensionOf(name) {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function isSupported(name, mime) {
  return ALLOWED_EXT.has(extensionOf(name)) || ALLOWED_MIME.has((mime || '').toLowerCase())
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

// Translate the variance settings sent by the UI into engine thresholds. Only
// finite, non-negative numbers are honored; anything else lets the pipeline fall
// back to the central defaults. Returns undefined when no override applies.
function thresholdsFromSettings(varianceSettings) {
  const amount = Number(varianceSettings?.dollarThreshold)
  const percent = Number(varianceSettings?.percentThreshold)
  if (Number.isFinite(amount) && amount >= 0 && Number.isFinite(percent) && percent >= 0) {
    return { amount, percent }
  }
  return undefined
}

// Pure response builder — no HTTP, no streams. Validates the upload, then runs
// the deterministic pipeline on the base report's extraction. Returns
// { status, body } so it can be unit-tested directly with `node --test`.
//
//   files        : [{ name, size, type, role }]  (validated metadata only)
//   extractions  : { base, supporting:[...] }     (browser-normalized results)
//   style        : parsed style settings object (or null)
//   variance     : parsed variance settings object (or null)
export async function buildGenerateResponse({ files = [], extractions = null, style = null, variance = null, ip = null, llmMode = 'conservative', _validateForTest = null } = {}) {
  // A base variance report must be present before anything is analyzed.
  const hasBase = files.some((f) => f.role === 'baseReport')
  if (!hasBase) {
    return { status: 422, body: { success: false, error: 'Add a base variance report before generating.' } }
  }

  // The pipeline needs the base report's normalized extraction. The browser
  // produces this; if it is missing or did not extract cleanly we say so plainly
  // rather than inventing an analysis.
  let base = extractions && typeof extractions === 'object' ? extractions.base : null
  if (!base || typeof base !== 'object') {
    return { status: 422, body: { success: false, error: 'The base report could not be read for analysis.' } }
  }
  if (base.status && base.status !== 'ok') {
    return { status: 422, body: { success: false, error: 'The base report could not be read for analysis.' } }
  }

  // Generate-time file-role validation (Option A: auto-correct with notice). One
  // LLM call BEFORE computeVariance looks at a small content sample from each file
  // and, when the user's base assignment is wrong (e.g. a budget selected as the
  // base), re-routes so the real variance report becomes the base. Gated by the
  // SAME flag + rate limit + circuit breaker as enrichment, so it counts against
  // the same limits; any failure / low confidence ⇒ no correction (silent). Only
  // generate-time routing changes here — never variance logic or display labels.
  let supporting = Array.isArray(extractions && extractions.supporting) ? extractions.supporting : []
  let filesOut = files
  let correction = null
  const validator = _validateForTest
    ? _validateForTest
    : LLM_ENABLED && llmMode === 'cited' && checkIpLimit(ip || 'unknown') && checkGlobalLimit()
      ? validateFileRoles
      : null
  if (validator) {
    const result = await validator({ base, supporting, files })
    if (result && result.corrected) {
      base = result.base
      supporting = result.supporting
      filesOut = result.files || files
      correction = { corrected: true, notice: result.notice, baseFileId: result.baseFileId, supportingFileIds: result.supportingFileIds }
    }
  }

  const thresholds = thresholdsFromSettings(variance)
  const { extraction, variance: varianceResult, narrative } = runPipeline(base, { thresholds })

  // LLM enrichment — runs only when the server flag is on AND the client
  // explicitly requests cited mode AND both rate limits permit. On any limit
  // breach the deterministic narrative is returned unchanged, with no error
  // surfaced to the client.
  //
  // Fix A (surface-only): we ALSO capture WHY enrichment did not run, as a fixed
  // enum ('ok' | 'rate_limit' | 'circuit_breaker' | 'api_error'), so the client
  // and the exports can show an honest status. The default is 'api_error' (the
  // catch-all: AI not available for this run, e.g. the flag is off). The rate-
  // limiter and circuit-breaker calls, their order, and the "enrich only when
  // both pass" condition are UNCHANGED — this only reads decisions already made.
  let finalNarrative = narrative
  let enrichmentReason = 'api_error'
  if (LLM_ENABLED && llmMode === 'cited') {
    const ipAllowed = checkIpLimit(ip || 'unknown')
    const globalAllowed = ipAllowed && checkGlobalLimit()
    if (ipAllowed && globalAllowed) {
      // Run deterministic enrichment server-side to populate note.support and
      // note.preparedEvidence on matching notes. The client will skip notes
      // already marked enriched:true, so there is no double-enrichment. Uses the
      // (possibly corrected) supporting set from role validation above.
      // Fix B (wiring): honor the active Style panel's reportStyle instead of a
      // hardcoded 'detailed', so Concise vs Detailed reaches the deterministic
      // commentary even on the LLM-enriched path.
      const enrichedNarrative = enrichNarrative(narrative, { supporting, mode: commentaryModeFromStyle(style) })

      // For each period, replace the evidence sentence with LLM commentary
      // where GL support data is available. Falls back per-note on any failure.
      // The shared `llmDiagnostics` learns of any API/network failure (set to
      // 'api_error') without altering the per-note fallback behavior.
      const llmDiagnostics = { reason: 'ok' }
      const llmPeriods = await Promise.all(
        enrichedNarrative.periods.map(async (period) => ({
          ...period,
          highVariances: await enrichWithLLM(period.highVariances, { period: period.period, style, diagnostics: llmDiagnostics })
        }))
      )
      finalNarrative = { ...enrichedNarrative, periods: llmPeriods }
      enrichmentReason = llmDiagnostics.reason
    } else {
      // Short-circuit matches the original: checkGlobalLimit is only consulted
      // when the IP limit passed, so !ipAllowed means the IP limit was the breach.
      enrichmentReason = ipAllowed ? 'circuit_breaker' : 'rate_limit'
    }
  }

  const settingsReceived = Boolean(style && variance)
  // Server-minted Job ID. No real job is stored; it only labels this response.
  const jobId = 'JOB-' + String(Date.now()).slice(-6)

  return {
    status: 200,
    body: {
      success: true,
      jobId,
      filesReceived: files.length,
      settingsReceived,
      files: filesOut,
      extraction,
      variance: varianceResult,
      narrative: finalNarrative,
      // Fix A: the fixed-enum fallback reason for this run, so the client/exports
      // can show an honest enrichment status. Surface-only; nothing else reads it.
      enrichmentReason,
      // Generate-time role correction (Option A). null when no re-route happened;
      // the client shows the notice and re-routes its own enrichment supporting set.
      correction
    }
  }
}

// Safely parse a JSON form field; returns null on absence or malformed input so
// a bad field degrades into a clean validation error instead of a crash.
function parseJsonField(value) {
  if (typeof value !== 'string' || value === '') return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function handleGenerate(req, res) {
  let bb
  try {
    bb = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES }
    })
  } catch {
    // Not multipart / missing boundary / malformed request line.
    sendJson(res, 400, { success: false, error: 'The request was not a valid file upload.' })
    return
  }

  const files = [] // { name, size, type, role } — metadata only
  const fields = {} // style, variance, notes, extractions (raw strings)
  let responded = false
  let firstError = null // { status, error } — first problem wins

  function flagError(status, error) {
    if (!firstError) firstError = { status, error }
  }

  bb.on('field', (name, value) => {
    fields[name] = value
  })

  bb.on('file', (name, stream, info) => {
    const { filename, mimeType } = info
    const role = name === 'baseReport' ? 'baseReport' : 'supportingFile'
    let size = 0
    let truncated = false

    // Count bytes, then let them go. No buffering, no disk, no logging.
    stream.on('data', (chunk) => { size += chunk.length })
    stream.on('limit', () => { truncated = true })
    stream.on('end', () => {
      if (truncated) {
        flagError(413, `"${filename}" is too large. The limit is 25 MB per file.`)
        return
      }
      if (!filename) {
        flagError(400, 'A file was uploaded without a name.')
        return
      }
      if (size === 0) {
        flagError(422, `"${filename}" is empty. Choose a file that has content.`)
        return
      }
      if (!isSupported(filename, mimeType)) {
        flagError(415, `"${filename}" is not a supported file type. Use PDF, XLSX, XLS, CSV, or DOCX.`)
        return
      }
      files.push({ name: filename, size, type: mimeType || '', role })
    })
  })

  bb.on('error', () => {
    if (responded) return
    responded = true
    sendJson(res, 400, { success: false, error: 'The upload could not be read. Please try again.' })
  })

  bb.on('close', () => {
    if (responded) return
    responded = true

    // Transport-level problems (size/type/empty/no-name) win before analysis.
    if (firstError) {
      sendJson(res, firstError.status, { success: false, error: firstError.error })
      return
    }

    const clientIp = req.socket?.remoteAddress || req.connection?.remoteAddress || null
    buildGenerateResponse({
      files,
      extractions: parseJsonField(fields.extractions),
      style: parseJsonField(fields.style),
      variance: parseJsonField(fields.variance),
      ip: clientIp,
      llmMode: fields.llmMode === 'cited' ? 'cited' : 'conservative'
    }).then(({ status, body }) => {
      sendJson(res, status, body)
    }).catch(() => {
      sendJson(res, 500, { success: false, error: 'An unexpected error occurred.' })
    })
  })

  req.pipe(bb)
}
