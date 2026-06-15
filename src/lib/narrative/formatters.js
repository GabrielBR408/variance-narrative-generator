// --- Narrative formatters — Phase 9A --------------------------------------
// Pure presentation helpers shared by the template and section builders. These
// only format values that already exist on a comparison record — they never
// invent, round away, or synthesize numbers. Deterministic and side-effect
// free so the same record always renders the same words.

// Owner-ready money: "$7,874.80", "-$1,200". Mirrors the variance preview's
// formatting (up to two decimals, thousands separators) for a consistent voice.
export function formatMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}`
}

// Magnitude only — used in sentences where the direction is carried by the verb
// ("exceeded budget by $7,874.80") so the dollar figure stays unsigned.
export function formatAbsMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}`
}

// Whole-number-percent input (e.g. 21.06 → "21.1%"). Unsigned to match the
// unsigned dollar magnitude in the same sentence.
export function formatAbsPercent(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null
  return `${Math.abs(n).toFixed(1)}%`
}

// Short label for the period toggle / headings.
export function periodLabel(period) {
  if (period === 'current') return 'Current'
  if (period === 'ytd') return 'YTD'
  return period ? String(period) : 'Current'
}

// In-sentence phrasing of the period so each line carries its own time context.
export function periodPhrase(period) {
  if (period === 'ytd') return 'year-to-date'
  if (period === 'current') return 'for the current period'
  return period ? `for ${period}` : 'for the current period'
}

// How a variance was measured. Drives the basis wording in templates.
export function comparisonBasis(comparisonType) {
  if (comparisonType === 'prior') return 'the prior period'
  return 'budget'
}

export function capitalize(s) {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}
