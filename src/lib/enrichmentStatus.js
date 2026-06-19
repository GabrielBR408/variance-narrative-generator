// --- Enrichment run status — Fix Phase A (trust fix, surface-only) ----------
// A deterministic, read-only summary of whether the LLM enrichment actually ran
// for ONE generated narrative, and — when it did not — WHY it fell back. This is
// the trust-gap fix from diagnostic PR #87: every Style control except Abbreviate
// lives only in the LLM instruction path, so when the LLM output is held flat
// (API error, IP rate limit, or the daily circuit breaker) the app silently
// shows the deterministic narrative and the user is never told.
//
// PURE and surface-only: it READS the already-produced narrative (the per-line
// `llmEnriched` flag set by server/llm.js enrichWithLLM, and the GL `support`
// metadata) plus the fallback `reason` the server reports. It does NO enrichment,
// matching, variance math, or text generation, and it NEVER changes narrative
// output, templates, style logic, or the fallback behavior — it only describes
// what already happened. It exposes no amounts, vendors, or GL rows — only counts
// and coarse status/reason strings.

// The fixed reason enum the server reports (server/generate.js). Anything outside
// this set — including a missing reason (e.g. the static-host client fallback,
// where there is no server to report one) — collapses to the catch-all
// 'api_error', per the Fix A spec.
export const ENRICHMENT_REASONS = ['ok', 'rate_limit', 'circuit_breaker', 'api_error']

// Plain-language, non-jargon copy for each fallback reason.
const REASON_TEXT = {
  rate_limit: 'daily limit reached',
  circuit_breaker: 'daily capacity reached',
  api_error: 'AI temporarily unavailable'
}

// Same GL surface signal the rest of the app uses (copied so this helper has no
// dependency on internal enrichment modules).
const GL_TYPE_RE = /general\s*ledger|\bgl\b/i

// Sections that can carry an LLM-enriched, GL-supported variance note.
const FLAGGED_SECTIONS = ['highVariances', 'revenueNotes', 'expenseNotes']

// Coerce any input to a known reason; default to the catch-all 'api_error' when
// the reason can't be determined.
export function normalizeReason(reason) {
  return ENRICHMENT_REASONS.includes(reason) ? reason : 'api_error'
}

// True when a note carries a General Ledger supporting citation — i.e. it is a
// line the LLM WOULD enrich when the AI is available.
function noteIsGLEligible(note) {
  return (
    !!note &&
    Array.isArray(note.support) &&
    note.support.some((s) => GL_TYPE_RE.test(String(s && s.classificationType)))
  )
}

// Count, across all periods, the GL-eligible notes and the notes the LLM actually
// enriched (llmEnriched === true).
function countNotes(narrative) {
  let eligibleCount = 0
  let enrichedCount = 0
  const periods = narrative && Array.isArray(narrative.periods) ? narrative.periods : []
  for (const p of periods) {
    for (const key of FLAGGED_SECTIONS) {
      const notes = Array.isArray(p && p[key]) ? p[key] : []
      for (const note of notes) {
        if (noteIsGLEligible(note)) eligibleCount++
        if (note && note.llmEnriched === true) enrichedCount++
      }
    }
  }
  return { eligibleCount, enrichedCount }
}

// Summarize the enrichment outcome for one narrative + the server-reported reason.
// Returns:
//   { reason, reasonText, status, statusKind, message,
//     enrichedCount, eligibleCount, fallbackCount }
// statusKind is one of:
//   'enriched' — every eligible line was AI-enriched ("AI-enriched")
//   'partial'  — SOME eligible lines were AI-enriched, the rest use the basic
//                narrative (honest middle state — never says "unavailable")
//   'fallback' — zero of the eligible lines were enriched → AI was unavailable
//   'none'     — there were no GL-eligible lines, so there was nothing to enrich
// The state is driven purely by enrichedCount vs the eligible (total) line count,
// which countNotes already computed — no new data source. Pure: same inputs
// always yield the same object.
export function enrichmentStatus({ narrative, reason } = {}) {
  const r = normalizeReason(reason)
  const { eligibleCount, enrichedCount } = countNotes(narrative)
  // The number of lines that COULD be AI-enriched (the "of 25" denominator).
  const totalCount = eligibleCount
  const fallbackCount = Math.max(0, totalCount - enrichedCount)

  // FULL — every eligible line was enriched.
  if (enrichedCount > 0 && enrichedCount === totalCount) {
    return {
      reason: 'ok',
      reasonText: '',
      status: 'AI-enriched',
      statusKind: 'enriched',
      message: 'AI-enriched — narrative reflects your style settings.',
      enrichedCount,
      eligibleCount: totalCount,
      fallbackCount: 0
    }
  }

  // PARTIAL — some lines enriched, some fell back. This is the honest middle
  // state: it reports the counts and NEVER says "unavailable" (the AI clearly
  // worked for the enriched lines).
  if (enrichedCount > 0 && enrichedCount < totalCount) {
    return {
      reason: r,
      reasonText: '',
      status: 'Partial AI enrichment',
      statusKind: 'partial',
      message: `Partial AI enrichment — ${enrichedCount} of ${totalCount} lines AI-enriched; the rest use the basic narrative. Style settings other than dollar formatting may not apply to the basic lines.`,
      enrichedCount,
      eligibleCount: totalCount,
      fallbackCount
    }
  }

  // ZERO enriched, but there WERE eligible lines → the AI was genuinely
  // unavailable for this run. Use the server's reason when it has one; a zero
  // run with no specific reason ('ok' but nothing enriched) collapses to the
  // 'api_error' catch-all.
  if (enrichedCount === 0 && totalCount > 0) {
    const effReason = r === 'ok' ? 'api_error' : r
    const reasonText = REASON_TEXT[effReason] || REASON_TEXT.api_error
    return {
      reason: effReason,
      reasonText,
      status: 'Basic narrative (AI unavailable)',
      statusKind: 'fallback',
      message: `Basic narrative shown — AI was unavailable (${reasonText}). Style settings other than dollar formatting may not apply.`,
      enrichedCount: 0,
      eligibleCount: totalCount,
      fallbackCount: totalCount
    }
  }

  // No GL-eligible lines at all → there was nothing for the AI to enrich. Not a
  // failure, and we do NOT claim the style settings were applied.
  return {
    reason: 'ok',
    reasonText: '',
    status: 'Basic narrative',
    statusKind: 'none',
    message:
      'Basic narrative shown — no supporting general-ledger detail to enrich. Add a GL file to enable AI commentary.',
    enrichedCount: 0,
    eligibleCount: 0,
    fallbackCount: 0
  }
}

// A single, self-documenting line for a downloaded export header (XLSX Owner
// Summary). Mirrors the on-screen status (same three-state logic) so a saved
// file and the screen always agree.
export function enrichmentStatusLine(enrichment) {
  if (!enrichment || typeof enrichment !== 'object') return ''
  // Partial carries its counts so the header matches the on-screen line.
  if (enrichment.statusKind === 'partial') {
    return `Partial AI enrichment — ${enrichment.enrichedCount} of ${enrichment.eligibleCount} lines AI-enriched`
  }
  const base = enrichment.status || ''
  return enrichment.reasonText ? `${base} — ${enrichment.reasonText}` : base
}
