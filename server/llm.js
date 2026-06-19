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

    // Fallback: when preparedEvidence produced no usable rows (e.g. unresolved
    // column model with no vendor/memo text), synthesize a row from the citation
    // detail summary so the LLM always has some evidence to cite.
    if (glRows.length === 0 && Array.isArray(note.support)) {
      for (const citation of note.support) {
        const d = citation && citation.detail
        if (!d) continue
        const vendor = d.vendor || d.description || null
        const amount = typeof d.total === 'number' ? d.total : null
        if (vendor || amount !== null) {
          glRows.push({ date: null, vendor, amount, memo: null })
          if (glRows.length >= MAX_GL_ROWS) break
        }
      }
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
  // Fix B (direction): variance direction is determined deterministically from
  // the account type and the variance sign — it is NOT the model's call. The
  // model must describe WHY a variance occurred, never WHETHER it is good or bad,
  // so its prose can never flip a line between favorable and unfavorable.
  'do not state or imply whether the variance is favorable or unfavorable, ' +
  'good or bad, positive or negative, better or worse, or over/under budget — ' +
  'that judgment is made elsewhere; describe only the nature of the activity; ' +
  'do not use hedging language such as \'appears\', \'may\', or \'possibly\' — ' +
  'the GL rows are the evidence.'

// --- Style instructions — Phase 23 (Style controls) -------------------------
// Translate the five active Style controls into a plain-English STYLE
// INSTRUCTIONS block appended to the system prompt, so the model follows the
// owner's chosen Report Style / Tone / Length / dollar abbreviation / dollar
// references. Pure and exported so the prompt wiring can be tested without a
// live API call. Unknown/missing values fall back to the App defaults.
export function buildStyleInstructions(style = {}) {
  const s = style || {}
  const reportStyle = s.reportStyle === 'Concise' ? 'Concise' : 'Detailed'
  const tone = s.tone === 'Cautious' ? 'Cautious' : 'Neutral'
  const length = ['Brief', 'Standard', 'Verbose'].includes(s.length) ? s.length : 'Standard'
  const abbreviate = s.abbreviateDollars === true
  const references = s.dollarReferences === 'Minimum' ? 'Minimum' : 'Detail'

  const parts = []
  parts.push(`Write in a ${reportStyle} style with ${tone} tone and ${length} length.`)

  parts.push(reportStyle === 'Concise'
    ? 'Concise style: tight, direct sentences with one clear statement per variance line.'
    : 'Detailed style: a fuller explanation with more context around each variance.')

  // Tone. Cautious explicitly overrides the no-hedging rule in the base prompt;
  // Neutral keeps that rule (direct, factual language).
  parts.push(tone === 'Cautious'
    ? 'Cautious tone: use softer, hedging language such as "appears to", "may reflect", and "consistent with". This overrides the instruction above to avoid hedging.'
    : 'Neutral tone: use direct, factual language without hedging.')

  parts.push(length === 'Brief'
    ? 'Brief length: the shortest viable commentary per line.'
    : length === 'Verbose'
      ? 'Verbose length: extended commentary with more supporting context.'
      : 'Standard length: a normal, balanced amount of commentary per line.')

  parts.push(abbreviate
    ? 'Abbreviate dollar values (for example, $5K, $1.2M, $3.4M).'
    : 'Do not abbreviate dollar values; write full figures (for example, $5,000 and $1,200,000).')

  parts.push(references === 'Minimum'
    ? 'Reference only the variance figure, not the actual or budget figures, in narrative text.'
    : 'Reference the actual, budget, and variance figures in narrative text.')

  return `STYLE INSTRUCTIONS: ${parts.join(' ')}`
}

// Compose the full system prompt: the fixed base rules plus the active style
// instructions. Used by enrichWithLLM and exercised directly in tests.
export function buildSystemPrompt(style) {
  return `${SYSTEM_PROMPT}\n\n${buildStyleInstructions(style)}`
}

// --- enrichWithLLM ----------------------------------------------------------
// Accepts enriched flaggedNotes (note.support + note.enriched must be set —
// call enrichNarrative first) and context { period }.
// Returns the notes array with LLM commentary merged onto qualifying notes.
// On any failure, returns the original notes unchanged (no error surfaced).
//
//   flaggedNotes : array of variance note objects (post-deterministic-enrichment)
//   context      : { period, style, diagnostics } — the period key for this set
//                  of notes, the active Style settings (folded into the system
//                  prompt), and an OPTIONAL mutable `diagnostics` object the caller
//                  may pass to learn WHY enrichment fell back (Fix A, surface-only).
//                  When the LLM call fails (no key, or an API/network error)
//                  `diagnostics.reason` is set to 'api_error'; the no-support and
//                  success paths leave it untouched, so a shared object across
//                  periods stays 'ok' unless a real failure occurs. This NEVER
//                  changes the return value or the fallback behavior — the notes
//                  are returned unchanged on every failure exactly as before.
export async function enrichWithLLM(flaggedNotes, { period = '', style = null, diagnostics = null } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.log('[LLM] ANTHROPIC_API_KEY not set — returning deterministic notes')
    if (diagnostics) diagnostics.reason = 'api_error'
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
      system: buildSystemPrompt(style),
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
    if (diagnostics) diagnostics.reason = 'api_error'
    return flaggedNotes
  }
}
