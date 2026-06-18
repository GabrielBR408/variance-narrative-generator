// LLM infrastructure — Phase NQ-6A.
// Feature-flagged OFF by default. NQ-6B will implement the real Anthropic call.
// ANTHROPIC_API_KEY is read from process.env only — never hardcoded, never logged.

// --- Feature flag -----------------------------------------------------------
// Set LLM_ENABLED=true in the environment to turn this on. Defaults to false.
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

// --- enrichWithLLM stub -----------------------------------------------------
// NQ-6B will replace the body with a real Anthropic API call.
// For now: returns flaggedNotes unchanged and logs that it is a stub.
//
//   flaggedNotes : array of variance note objects
//   glEvidence   : object with GL line-item evidence
//   returns      : flaggedNotes (unmodified)
export async function enrichWithLLM(flaggedNotes, _glEvidence) {
  console.log('[LLM] LLM enrichment stub called — not yet implemented')
  return flaggedNotes
}
