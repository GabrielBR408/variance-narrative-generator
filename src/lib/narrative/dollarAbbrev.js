// --- Dollar abbreviation — Phase 23 (Style controls) -----------------------
// Optional presentation transform applied to FINISHED narrative text when the
// user enables the "Abbreviate Dollar Values" Style control. It rewrites figures
// like "$5,000" to "$5K" and "$1,200,000" to "$1.2M". It is purely cosmetic — it
// never changes which rows are flagged, the variance math, or the evidence; it
// only reformats already-rendered dollar tokens in the output sentences.
//
// Default is OFF. When off, applyDollarAbbreviation returns the SAME narrative
// reference (byte-identical output), so the deterministic fallback behavior and
// all existing tests are untouched.

// Matches an optional leading minus, a "$", optional space, then a number with
// optional thousands separators and optional decimals: "-$1,200.50", "$5,000".
const MONEY_RE = /(-?)\$\s?(\d[\d,]*(?:\.\d+)?)/g

// Round to one decimal and drop a trailing ".0" so 5 → "5", 1.2 → "1.2".
function trimDecimal(x) {
  return String(Math.round(x * 10) / 10).replace(/\.0$/, '')
}

// Abbreviation tiers, smallest first: thousands, millions, billions.
const DOLLAR_UNITS = [
  { value: 1_000, suffix: 'K' },
  { value: 1_000_000, suffix: 'M' },
  { value: 1_000_000_000, suffix: 'B' }
]

// Abbreviate a single numeric dollar amount: 5000 → "$5K", 1200000 → "$1.2M",
// -3400000 → "-$3.4M", 1500000000 → "$1.5B". Magnitudes under $1,000 are
// returned as a plain "$N" (abbreviation is meaningless below a thousand). A
// value that ROUNDS UP across a unit boundary is promoted to the next tier
// ($999,999 → "$1M", never "$1000K"). Non-finite input → null.
export function abbreviateDollarAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs < 1_000) return `${sign}$${trimDecimal(abs)}`
  let i = DOLLAR_UNITS.length - 1
  while (i > 0 && abs < DOLLAR_UNITS[i].value) i--
  // Rounding promotion: 999,950+ scales to "1000K" at the thousands tier — the
  // next tier up says it better ("$1M").
  if (i < DOLLAR_UNITS.length - 1 && Math.round((abs / DOLLAR_UNITS[i].value) * 10) / 10 >= 1000) i++
  return `${sign}$${trimDecimal(abs / DOLLAR_UNITS[i].value)}${DOLLAR_UNITS[i].suffix}`
}

// Rewrite every dollar token in a string to its abbreviated form. Figures below
// $1,000 are left exactly as written (so "$614.87" stays "$614.87"); only
// thousands-and-up are abbreviated. Non-strings pass through unchanged.
export function abbreviateDollarsInText(text) {
  if (typeof text !== 'string') return text
  return text.replace(MONEY_RE, (match, sign, num) => {
    const value = Number(num.replace(/,/g, ''))
    if (!Number.isFinite(value) || value < 1000) return match
    return abbreviateDollarAmount(sign === '-' ? -value : value)
  })
}

// Sections whose notes carry owner-facing sentences with dollar figures. The
// engine emits the executive summary as an ARRAY of note objects (like every
// other section), and Context Notes carries re-homed variance sentences — both
// must abbreviate alongside the High/Revenue/Expense notes.
const TEXT_SECTIONS = ['executiveSummary', 'highVariances', 'revenueNotes', 'expenseNotes', 'contextNotes']

// Apply dollar abbreviation across a finished narrative when `enabled`. When
// disabled (the default) the narrative is returned unchanged by reference. Only
// the rendered text strings are rewritten — the structured `support`,
// `varianceAmount`, and every other field stay exactly as produced.
export function applyDollarAbbreviation(narrative, enabled) {
  if (!enabled || !narrative || !Array.isArray(narrative.periods)) return narrative

  const periods = narrative.periods.map((period) => {
    if (!period || typeof period !== 'object') return period
    const next = { ...period }
    // Defensive: tolerate a legacy/hand-built string executive summary.
    if (typeof period.executiveSummary === 'string') {
      next.executiveSummary = abbreviateDollarsInText(period.executiveSummary)
    }
    for (const key of TEXT_SECTIONS) {
      if (!Array.isArray(period[key])) continue
      next[key] = period[key].map((note) => {
        if (!note || typeof note !== 'object' || typeof note.text !== 'string') return note
        const text = abbreviateDollarsInText(note.text)
        return text === note.text ? note : { ...note, text }
      })
    }
    return next
  })

  return { ...narrative, periods }
}
