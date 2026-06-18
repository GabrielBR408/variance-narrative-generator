// LLM infrastructure — Phase NQ-6A / NQ-6B.
// Feature-flagged OFF by default. Set LLM_ENABLED=true to activate.
// ANTHROPIC_API_KEY is read from process.env only — never hardcoded, never logged.

// --- Feature flag -----------------------------------------------------------
export const LLM_ENABLED = process.env.LLM_ENABLED === 'true'

// --- IP rate limiter --------------------------------------------------------
// Max 5 LLM requests per IP per 24-hour rolling window. In-memory only.
// On limit breach: log server-side, caller falls back to deterministic path.

const IP_LIMIT = 5
const WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

// Map<ip, { count, resetAt }>
const ipCounters = new Map()

export function checkIpLimit(ip) {
  const now = Date.now()
  let entry = ipCounters.get(ip)
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS }
    ipCounters.set(ip, entry)
  }
  if (entry.count >= IP_LIMIT) {
    console.log(`[LLM] IP rate limit reached for ${ip} — falling back to deterministic narrative`)
    return false
  }
  entry.count++
  return true
}

// --- Global circuit breaker -------------------------------------------------
// Max 200 LLM calls per 24-hour rolling window across all IPs. Single counter.
// On breach: log server-side, caller falls back to deterministic path.

const GLOBAL_LIMIT = 200

let globalCount = 0
let globalResetAt = Date.now() + WINDOW_MS

export function checkGlobalLimit() {
  const now = Date.now()
  if (now >= globalResetAt) {
    globalCount = 0
    globalResetAt = now + WINDOW_MS
  }
  if (globalCount >= GLOBAL_LIMIT) {
    console.log('[LLM] Global circuit breaker tripped — falling back to deterministic narrative')
    return false
  }
  globalCount++
  return true
}

// Exposed for tests only — resets both rate-limiter and circuit breaker state.
export function _resetLimitsForTest() {
  ipCounters.clear()
  globalCount = 0
  globalResetAt = Date.now() + WINDOW_MS
}

// --- Evidence packet builder ------------------------------------------------
// Exported for unit tests only. Builds the JSON payload sent to the LLM for
// each enriched note. Only notes that have gone through the deterministic
// enrichment pipeline (note.support populated, note.enriched === true) are
// included. Caps at MAX_NOTES and MAX_GL_ROWS to control token usage.

const MAX_NOTES = 10
const MAX_GL_ROWS = 40

export function _buildPackets(flaggedNotes, period) {
  const enrichable = Array.isArray(flaggedNotes)
    ? flaggedNotes.filter((n) => n && n.support && n.enriched === true)
    : []

  return enrichable.slice(0, MAX_NOTES).map((note, i) => {
    const diagnosis = note.diagnosis || {}

    let glRows = []
    if (note.preparedEvidence && Array.isArray(note.preparedEvidence.glRows)) {
      glRows = note.preparedEvidence.glRows
        .slice(0, MAX_GL_ROWS)
        .map((r) => ({
          date: null,
          vendor: r.vendor || null,
          amount: r.netAmount,
          memo: r.memo || null
        }))
        .filter((r) => r.amount !== null || r.vendor || r.memo)
    }

    return {
      _originalIndex: flaggedNotes.indexOf(note), // used for merge-back; stripped before sending
      index: i,
      account: note.account,
      varianceAmount: note.varianceAmount,
      variancePercent: note.variancePercent,
      comparisonType: note.comparisonType,
      period: period || '',
      diagnosis: {
        nature: diagnosis.nature || null,
        qualifiers: Array.isArray(diagnosis.qualifiers) ? diagnosis.qualifiers : [],
        confidence: diagnosis.confidence || null,
        basis: diagnosis.basis || null
      },
      glRows
    }
  })
}

// Strip internal fields before sending to the API.
function toApiPayload(packets) {
  return packets.map(({ _originalIndex: _omit, ...rest }) => rest)
}

// --- System prompt (exact, per spec) ----------------------------------------
const SYSTEM_PROMPT =
  'You are writing variance commentary for a commercial real estate owner report. ' +
  'You will be given a flagged account, its variance, diagnosis type, and matched GL rows. ' +
  'Write one to two sentences maximum. ' +
  'Rules: cite vendor names and reference numbers when present in the GL rows provided; ' +
  'distinguish one-time vs. recurring vs. timing vs. accounting true-up; ' +
  'lead with the diagnosis type framing ' +
  '(ACCRUAL_TRUEUP = reversal/true-up framing; ' +
  'TIMING_PHASING = budget phasing/timing framing; ' +
  'REAL_SPEND = vendor and nature of spend; ' +
  'MAPPING_PASSTHROUGH = offset/recovery structure); ' +
  'never invent figures not present in the provided rows; ' +
  'do not restate the dollar or percent amount; ' +
  'do not use hedging language such as \'appears\', \'may\', or \'possibly\' — ' +
  'the GL rows are the evidence.'

// --- enrichWithLLM ----------------------------------------------------------
// Accepts enriched flaggedNotes (note.support + note.enriched must be set —
// call enrichNarrative first) and context { period }.
// Returns the notes array with LLM commentary merged onto qualifying notes.
// On any failure, returns the original notes unchanged (no error surfaced).
//
//   flaggedNotes : array of variance note objects (post-deterministic-enrichment)
//   context      : { period } — the period key for this set of notes
export async function enrichWithLLM(flaggedNotes, { period = '' } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.log('[LLM] ANTHROPIC_API_KEY not set — returning deterministic notes')
    return flaggedNotes
  }

  const packets = _buildPackets(flaggedNotes, period)
  if (packets.length === 0) {
    console.log('[LLM] No enriched notes with support data — returning deterministic notes')
    return flaggedNotes
  }

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey })

    const userContent =
      JSON.stringify(toApiPayload(packets)) +
      '\n\nReturn a JSON array: [{"index": N, "commentary": "..."}]. ' +
      'One to two sentences per account. ' +
      'Only reference figures and vendor names present in glRows.'

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }]
    })

    const text = (response.content && response.content[0] && response.content[0].text) || ''

    // Strip markdown code fences if the model wraps its JSON.
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const parsed = JSON.parse(jsonText)
    if (!Array.isArray(parsed)) throw new Error('unexpected LLM response shape')

    // Merge enriched commentaries back onto the original notes array.
    const result = [...flaggedNotes]
    for (const entry of parsed) {
      const packet = packets[entry.index]
      if (!packet || typeof entry.commentary !== 'string' || !entry.commentary.trim()) continue
      const originalIdx = packet._originalIndex
      const note = result[originalIdx]
      if (!note) continue
      // S1 = the original variance sentence (pre-enrichment text).
      // S2 = the LLM commentary sentence replaces the deterministic evidence sentence.
      const s1 = String(note.originalText || note.text).replace(/\s*\.?\s*$/, '')
      result[originalIdx] = {
        ...note,
        text: `${s1}. ${entry.commentary.trim()}`,
        llmEnriched: true
      }
    }
    return result
  } catch (err) {
    console.log('[LLM] API call failed — returning deterministic notes:', String(err && err.message ? err.message : err))
    return flaggedNotes
  }
}
