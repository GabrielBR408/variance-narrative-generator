// --- Generate-time file-role validation — LLM (Option A: auto-correct) ------
// Before computeVariance runs, this asks the LLM to look at a SMALL content
// sample from each uploaded file and decide what role each should play, then
// auto-corrects the base/supporting routing when the user's assignment is wrong
// (e.g. a budget exported as "GL Worksheet" was selected as the base). The
// variance report the LLM identifies becomes the base; everything else is
// supporting. Applies to ALL files, not just budgets.
//
// SAFETY by construction:
//   • Pure helpers (sample build / response parse / correction) are deterministic
//     and unit-tested; the only non-determinism is the single model call, which is
//     injectable for tests.
//   • Acts ONLY on "high" confidence. Low/unknown/ambiguous ⇒ keep the user's
//     original assignment. Never corrects on ambiguity (0 or >1 variance reports).
//   • Any failure (no key, network/timeout, malformed JSON, non-array) ⇒ returns
//     null, so generation proceeds with the user's original assignment. Validation
//     never blocks generation.
//   • It only re-routes generate-time roles; it never mutates variance logic,
//     thresholds, narrative text, or the upload-time display labels.

// Token budget for the content sample. Headers + a few rows per file is enough to
// identify type (Actual/Budget/Variance vs monthly budget vs Debit/Credit), and
// keeps the single call small.
const MAX_SAMPLE_ROWS = 5
const MAX_SAMPLE_COLS = 24
const CELL_MAX_CHARS = 40

const VALID_ROLES = new Set(['variance_report', 'standalone_budget', 'general_ledger', 'unknown'])

// The model used for enrichment (server/llm.js) — reuse it for validation so the
// call shares the same API path and key.
const VALIDATION_MODEL = 'claude-haiku-4-5-20251001'

const VALIDATION_SYSTEM_PROMPT =
  'You classify uploaded financial files by their STRUCTURE so a variance report ' +
  'can be generated from the correct base file. You are given a small content ' +
  'sample (filename, column headers, and a few rows) for each file. ' +
  'Classify each file as exactly one of: ' +
  '"variance_report" (a comparative income statement — has Actual AND Budget AND ' +
  'Variance columns for a period/YTD; this is the base the report is built from); ' +
  '"standalone_budget" (budget figures only, e.g. monthly columns, NO actuals); ' +
  '"general_ledger" (transaction rows — dates, debit/credit, references); ' +
  '"unknown" (not enough signal). ' +
  'Judge by content/structure, NOT the filename. Use confidence "high" only when ' +
  'the structure clearly matches; otherwise "low". ' +
  'Return ONLY a JSON array, no prose, no code fence: ' +
  '[{"filename":"...","role":"variance_report|standalone_budget|general_ledger|unknown","confidence":"high|low"}].'

function clampCell(v) {
  const s = v === null || v === undefined ? '' : String(v)
  return s.length > CELL_MAX_CHARS ? s.slice(0, CELL_MAX_CHARS) : s
}

// One compact, faithful sample per extraction. Reads only the normalized shape
// (headers + first few rows + the content fileType tag) — never raw file text.
function sampleOf(ex, currentRole) {
  const normalized = (ex && ex.normalized) || {}
  const columns = Array.isArray(normalized.columns) ? normalized.columns.slice(0, MAX_SAMPLE_COLS).map(clampCell) : []
  const rows = Array.isArray(normalized.rows) ? normalized.rows : []
  const sampleRows = rows.slice(0, MAX_SAMPLE_ROWS).map((r) => (Array.isArray(r) ? r.slice(0, MAX_SAMPLE_COLS).map(clampCell) : []))
  return {
    filename: (ex && ex.fileName) || '',
    currentRole,
    fileType: normalized.fileType || null,
    columns,
    sampleRows
  }
}

// Build the per-file samples for { base, supporting[] }. Exported for tests.
export function buildRoleSamples(base, supporting = []) {
  const samples = []
  if (base) samples.push(sampleOf(base, 'baseReport'))
  for (const ex of Array.isArray(supporting) ? supporting : []) {
    if (ex) samples.push(sampleOf(ex, 'supportingFile'))
  }
  return samples
}

// The user message: the samples plus a restatement of the required JSON shape.
export function buildValidationUserContent(samples) {
  return (
    JSON.stringify(samples) +
    '\n\nClassify each file. Return ONLY the JSON array described in the system ' +
    'prompt — one object per filename, in any order.'
  )
}

// Parse the model's reply into a Map<filename, role> containing ONLY
// high-confidence, valid-role assignments. Returns null on any malformed input
// (not a string, bad JSON, not an array) so the caller falls back silently.
export function parseRoleResponse(text) {
  if (typeof text !== 'string' || !text.trim()) return null
  const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  let parsed
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const out = new Map()
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const filename = typeof entry.filename === 'string' ? entry.filename : null
    const role = typeof entry.role === 'string' ? entry.role : null
    const confidence = typeof entry.confidence === 'string' ? entry.confidence.toLowerCase() : null
    if (!filename || !VALID_ROLES.has(role)) continue
    // Only high-confidence assignments are eligible to act on.
    if (confidence === 'high') out.set(filename, role)
  }
  return out
}

// Decide whether to re-route, and to what. Conservative: corrects ONLY when the
// current base is NOT a high-confidence variance_report AND EXACTLY ONE other
// file is a high-confidence variance_report. Zero candidates (nothing better) or
// more than one (ambiguous) ⇒ no correction. Returns a correction object or null.
//
//   { corrected, notice, base, supporting, files, baseFileId, supportingFileIds }
export function applyRoleCorrection({ base, supporting = [], files = [], assignments } = {}) {
  if (!base || !(assignments instanceof Map) || assignments.size === 0) return null

  const baseName = base.fileName || ''
  if (assignments.get(baseName) === 'variance_report') return null // base is already correct

  const candidates = (Array.isArray(supporting) ? supporting : []).filter(
    (ex) => ex && assignments.get(ex.fileName || '') === 'variance_report'
  )
  if (candidates.length !== 1) return null // 0 = nothing better; >1 = ambiguous

  const newBase = candidates[0]
  const newSupporting = [base, ...supporting.filter((ex) => ex !== newBase)]

  const baseFileName = newBase.fileName || ''
  const supportingFileNames = newSupporting.map((ex) => ex.fileName || '').filter(Boolean)

  // Re-stamp the response file roles to match the corrected routing (by filename).
  const correctedFiles = (Array.isArray(files) ? files : []).map((f) => {
    if (!f || typeof f !== 'object') return f
    if (f.name === baseFileName) return { ...f, role: 'baseReport' }
    return { ...f, role: 'supportingFile' }
  })

  const notice =
    'We detected your files were assigned different roles than uploaded — ' +
    `we've adjusted automatically. Base report: ${baseFileName}. ` +
    `Supporting: ${supportingFileNames.join(', ')}. Generating now.`

  return {
    corrected: true,
    notice,
    base: newBase,
    supporting: newSupporting,
    files: correctedFiles,
    baseFileId: newBase.fileId || null,
    supportingFileIds: newSupporting.map((ex) => ex.fileId || null).filter(Boolean)
  }
}

// The default model caller: one structured Anthropic call, returning the raw
// reply text. Gated on the API key; returns '' when no key is set so the
// orchestrator falls back silently. Never throws to the caller's await without
// being caught upstream. Mirrors enrichWithLLM's client usage.
async function defaultCallModel(userContent) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return ''
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  // Bounded timeout: a stalled validation call must fail into "no correction"
  // (silent) rather than ride out the SDK default and hit the platform timeout.
  const client = new Anthropic({ apiKey, timeout: 30000, maxRetries: 1 })
  const response = await client.messages.create({
    model: VALIDATION_MODEL,
    max_tokens: 512,
    system: VALIDATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }]
  })
  return (response.content && response.content[0] && response.content[0].text) || ''
}

// Validate the file roles and return a correction, or null when no high-confidence
// re-route is warranted (or anything fails). `callModel` is injectable for tests;
// in production it defaults to the gated Anthropic call above.
//
//   { base, supporting:[...], files:[...] }  ⇒  correction | null
export async function validateFileRoles({ base, supporting = [], files = [], callModel = defaultCallModel } = {}) {
  if (!base) return null
  try {
    const samples = buildRoleSamples(base, supporting)
    // Nothing to compare against — a lone base file can't be re-routed.
    if (samples.length < 2) return null

    const text = await callModel(buildValidationUserContent(samples))
    const assignments = parseRoleResponse(text)
    if (!assignments) return null

    return applyRoleCorrection({ base, supporting, files, assignments })
  } catch {
    // Any failure (network, timeout, parse) ⇒ no correction, generation proceeds.
    return null
  }
}
