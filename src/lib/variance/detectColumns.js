// --- Column detection — Phase 8 -------------------------------------------
// Maps a normalized table's header row to the columns variance math needs:
// an account label column plus actual / budget / prior value columns.
//
// Deterministic, case-insensitive keyword matching only — no AI, no content
// inspection beyond the header strings (and a light numeric scan to locate the
// label column when no header names it). Same headers always yield the same map.

// Value-column patterns, per spec. Checked in this priority order so a column
// like "Prior Actual" resolves to the more specific intent (prior) rather than
// the generic "actual". First type whose pattern matches claims the column.
const COLUMN_PATTERNS = [
  ['prior', [/prior\s*month/, /last\s*month/, /\bprior\b/, /\bprevious\b/, /\bprev\b/]],
  ['budget', [/\bbudget\b/, /\bbud\b/, /\bplan\b/, /\bplanned\b/, /\bforecast\b/]],
  ['actual', [/\bactual\b/, /\bactuals\b/, /\bcurrent\b/, /\bact\b/, /\bcur\b/]]
]

// A variance/difference column carries DERIVED data the engine recomputes from
// Actual − Budget, so it is never claimed as a value column. Checked before the
// value patterns: a header like "Current Variance" also matches the generic
// actual pattern (/\bcurrent\b/), and letting it claim the `actual` slot steals
// the current period from the real unlabeled Actual|Budget block (which then
// misreports as YTD). The most specific match — variance — types the column.
const VARIANCE_COLUMN_RE = /\bvariance\b|\bvar\b|\bdiff(erence)?\b/

// Header names that explicitly identify the account/label column.
const ACCOUNT_RE = /account|acct|description|\bdesc\b|\bgl\b|\bname\b|line\s*item|\bitem\b|category|particulars/i

// Period marker. A value column whose header reads as year-to-date belongs to
// the YTD set; everything else (Current, MTD, plain "Actual"…) is the Current
// set. Deterministic keyword check only — same header, same period.
const YTD_RE = /\bytd\b|year[-\s]*to[-\s]*date|y[-.\s]*t[-.\s]*d\b/i

function detectPeriod(header) {
  return YTD_RE.test(String(header)) ? 'ytd' : 'current'
}

// Explicit period markers in a header. Returns 'ytd' / 'current' only when the
// header actually names the period, or null when it carries no period word (a
// bare "Actual" / "Budget"). This is stricter than detectPeriod (which defaults
// the unmarked case to 'current') so the block splitter below can tell a labeled
// period apart from a positional one.
const CURRENT_RE = /\bcurrent\b|\bmtd\b|month[-\s]*to[-\s]*date|this\s*month|current\s*period/i
function explicitPeriod(header) {
  const h = String(header)
  if (YTD_RE.test(h)) return 'ytd'
  if (CURRENT_RE.test(h)) return 'current'
  return null
}

function matchType(header) {
  const h = String(header).toLowerCase()
  if (VARIANCE_COLUMN_RE.test(h)) return null // derived column — never a value slot
  for (const [type, patterns] of COLUMN_PATTERNS) {
    if (patterns.some((re) => re.test(h))) return type
  }
  return null
}

// The bare period words ("Current", "Cur") claim the actual slot only as a
// GENERIC match — a header like "Current Notes" also matches. A column claimed
// generically must actually carry numbers; a mostly-text column is annotation,
// and letting it take the Actual slot reports "actual figure unavailable" on
// every row (or worse, computes variances from stray numerics in prose).
const SPECIFIC_ACTUAL_RE = /\bactual\b|\bactuals\b|\bact\b/

// Fraction of a column's sampled non-empty cells that read as numeric. Mirrors
// detectAccountColumn's textScore (same cell test, inverted); bounded sample
// keeps detection O(columns).
function numericShare(rows, i) {
  const sample = rows.slice(0, 50)
  let numeric = 0
  let seen = 0
  for (const row of sample) {
    const cell = Array.isArray(row) ? row[i] : undefined
    if (cell === undefined || cell === null || String(cell).trim() === '') continue
    seen++
    if (/^[\s$()%-]*\d/.test(String(cell).trim())) numeric++
  }
  // No data to judge (headers-only extraction) → don't overrule the header.
  return seen === 0 ? null : numeric / seen
}

// Locate the account label column. Prefer an explicitly named header; otherwise
// fall back to the first column that reads as mostly text across the data rows
// (account names are non-numeric), and finally to column 0.
function detectAccountColumn(columns, rows, valueIndexes) {
  const taken = new Set(valueIndexes)
  const sample = rows.slice(0, 50) // bounded scan keeps detection O(columns)

  // Fraction of a column's sampled cells that read as text (account NAMES read as
  // text; GL CODES read as numbers). Used both to choose among several named label
  // columns and as the no-header fallback.
  const textScore = (i) => {
    let text = 0
    let seen = 0
    for (const row of sample) {
      const cell = Array.isArray(row) ? row[i] : undefined
      if (cell === undefined || cell === null || String(cell).trim() === '') continue
      seen++
      // Non-numeric cells signal a label column.
      if (!/^[\s$()%-]*\d/.test(String(cell).trim())) text++
    }
    return seen === 0 ? 0 : text / seen
  }

  // Columns whose HEADER names a label column. When a statement carries BOTH a
  // code column ("GL Code", "Acct #") and a name column ("Account", "Description")
  // — both match ACCOUNT_RE — prefer the one whose data is actually text (the
  // names). Choosing the numeric-code column would label every narrative line by a
  // bare, unreadable code ("6230 exceeded budget…") AND blind the section-typing
  // pass, which reads the subtotal labels ("TOTAL OPERATING EXPENSES") from this
  // column to classify each line revenue vs expense. A code column is blank on
  // those subtotal rows, so no section is ever detected and every line falls back
  // to "unknown" (never favorable/unfavorable).
  const named = []
  for (let i = 0; i < columns.length; i++) {
    if (ACCOUNT_RE.test(String(columns[i]))) named.push(i)
  }
  if (named.length === 1) return named[0]
  if (named.length > 1) {
    let best = named[0]
    let bestScore = -1
    for (const i of named) {
      const score = textScore(i)
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    return best
  }

  // No header names a label column: fall back to the most text-like non-value
  // column, and finally to column 0.
  let best = -1
  let bestTextScore = -1
  for (let i = 0; i < columns.length; i++) {
    if (taken.has(i)) continue
    const score = textScore(i)
    if (score > bestTextScore) {
      bestTextScore = score
      best = i
    }
  }
  return best >= 0 ? best : 0
}

// Group every non-account column by its detected period, preserving order, so a
// column's position WITHIN its period band can be compared across periods. Used
// to recover value columns whose sub-labels a merged group band swallowed.
function groupColumnsByPeriod(columns, account) {
  const groups = new Map() // period -> [columnIndex, ...] in left-to-right order
  columns.forEach((header, i) => {
    if (i === account) return
    const period = detectPeriod(header)
    if (!groups.has(period)) groups.set(period, [])
    groups.get(period).push(i)
  })
  return groups
}

// Fill in value columns (actual / budget / prior) for any period the keyword
// pass left incomplete, by borrowing the type→offset layout of a period it
// fully resolved. A comparative statement lays each period out with the same
// column order, so the column at offset N under "Year-To-Date" carries the same
// value type as the column at offset N under "Current Period". Conservative: it
// only assigns a still-empty slot to a still-unclaimed column, so a period the
// keyword pass already resolved is never altered.
function inferUnlabeledPeriodColumns(columns, account, byPeriod, seen, valueIndexes) {
  // A clean template period has both an actual and a budget the keyword pass
  // resolved; without one there is nothing trustworthy to mirror.
  const template = [...byPeriod.entries()].find(
    ([, set]) => set.actual !== null && set.budget !== null
  )
  if (!template) return

  const groups = groupColumnsByPeriod(columns, account)
  const [templatePeriod, templateSet] = template
  const templateGroup = groups.get(templatePeriod) || []

  // offset (position within the period band) -> value type, for the columns the
  // keyword pass resolved on the template period.
  const offsetType = new Map()
  for (const type of ['actual', 'budget', 'prior']) {
    const idx = templateSet[type]
    if (idx === null) continue
    const offset = templateGroup.indexOf(idx)
    if (offset >= 0) offsetType.set(offset, type)
  }

  const claimed = new Set(valueIndexes)
  for (const [period, group] of groups) {
    if (period === templatePeriod) continue
    const set = byPeriod.get(period) || { actual: null, budget: null, prior: null }
    let filled = false
    for (const [offset, type] of offsetType) {
      const idx = group[offset]
      if (idx === undefined || claimed.has(idx)) continue
      if (set[type] !== null) continue
      set[type] = idx
      claimed.add(idx)
      valueIndexes.push(idx)
      filled = true
    }
    if (filled && !byPeriod.has(period)) {
      byPeriod.set(period, set)
      seen.push(period)
    }
  }
}

// Period-aware detection. Some statements lay Current and YTD comparisons side
// by side ("Current Actual | Current Budget | … | YTD Actual | YTD Budget | …").
// This groups the value columns by period so each can be compared on its own,
// while the account/label column is shared across all periods.
//
// Returns { account, sets: [{ period, columns: { actual, budget, prior } }] }.
// Sets are ordered Current first (the default/backward-compatible view), then
// YTD, then any other period in first-seen order. Within a period the first
// column to claim a value type wins.
export function detectComparisonSets(columns = [], rows = []) {
  if (!Array.isArray(columns) || columns.length === 0) {
    return { account: null, sets: [] }
  }

  // Block-aware grouping. A comparative statement lays its periods out as
  // repeating value blocks ("Actual | Budget | … " once per period). We split
  // those blocks so each period is detected on its own — even when the periods
  // are NOT distinguished by a "Current"/"YTD" label (a flat header row that
  // simply repeats "Actual | Budget | …", which the merged period band above it
  // did not survive as).
  //
  // A block boundary is a REPEATED value type (a SECOND "Actual" begins the next
  // period). We deliberately do NOT split on an explicit-label change, because a
  // merged period band that does not sit flush over its section (real exports
  // anchor "Year-To-Date" over the YTD *Budget*, one column right of YTD Actual)
  // leaves a stray "Current"/"YTD" word mid-block; splitting on it would tear the
  // YTD Actual off its own block and drop it. Each block's period is decided
  // afterward by scanning ALL of its column labels (see below).
  const blocks = [] // [{ set: { actual, budget, prior } }]
  let block = null
  const valueIndexes = []

  columns.forEach((header, i) => {
    const type = matchType(header)
    if (!type) return
    // Generic "Current …" headers ("Current Notes") must carry numeric data to
    // claim the Actual slot; see SPECIFIC_ACTUAL_RE above.
    if (type === 'actual' && !SPECIFIC_ACTUAL_RE.test(String(header).toLowerCase())) {
      const share = numericShare(rows, i)
      if (share !== null && share < 0.5) return
    }
    if (block === null || block.set[type] !== null) {
      block = { set: { actual: null, budget: null, prior: null } }
      blocks.push(block)
    }
    block.set[type] = i
    valueIndexes.push(i)
  })

  // Decide each block's period from the labels on ITS OWN value columns: any YTD
  // word anywhere in the block wins (so a band label shifted onto the block's
  // Budget column still tags the whole block YTD), then any Current/MTD word,
  // else unlabeled. This tolerates the band-misalignment above where the YTD
  // Actual column inherited the neighbouring "Current Period" label.
  function blockPeriod(b) {
    let ytd = false
    let current = false
    for (const t of ['actual', 'budget', 'prior']) {
      const idx = b.set[t]
      if (idx === null) continue
      const ep = explicitPeriod(columns[idx])
      if (ep === 'ytd') ytd = true
      else if (ep === 'current') current = true
    }
    return ytd ? 'ytd' : current ? 'current' : null
  }

  // Resolve each block to a period: a labeled block keeps its label; the rest
  // fall back to position (first block → current, second → ytd, …), skipping any
  // period an explicit label already claimed.
  const byPeriod = new Map() // period -> { actual, budget, prior } indexes
  const seen = [] // periods in first-seen order
  const labels = blocks.map(blockPeriod)
  const used = new Set(labels.filter(Boolean))
  const fallback = ['current', 'ytd']
  let fi = 0
  blocks.forEach((b, bi) => {
    let period = labels[bi]
    if (!period) {
      // Positional fallback slots ("first unlabeled block → current, second →
      // ytd") go only to COMPARABLE blocks. A stray non-comparable block (a
      // duplicated bare "Actual" header opens a second block, orphaning the
      // first with actual-only) previously consumed the "current" slot and was
      // then dropped by computeVariance — leaving the one real comparison
      // mislabeled "ytd" on a statement that never says YTD.
      const comparable = b.set.actual !== null && (b.set.budget !== null || b.set.prior !== null)
      if (!comparable) {
        period = `period${bi + 1}`
        used.add(period)
      } else {
        while (fi < fallback.length && used.has(fallback[fi])) fi++
        period = fi < fallback.length ? fallback[fi++] : `period${bi + 1}`
        used.add(period)
      }
    }
    if (!byPeriod.has(period)) {
      byPeriod.set(period, b.set)
      seen.push(period)
    } else {
      // Two blocks resolving to the same period (unusual): keep the first-seen
      // value columns, mirroring the original "first column wins" rule.
      const existing = byPeriod.get(period)
      for (const t of ['actual', 'budget', 'prior']) {
        if (existing[t] === null && b.set[t] !== null) existing[t] = b.set[t]
      }
    }
  })

  const account = detectAccountColumn(columns, rows, valueIndexes)

  // Recover a period whose value sub-labels were not repeated under its group
  // band. Side-by-side comparative income statements often print "Actual |
  // Budget | Variance | Variance %" only beneath the FIRST period ("Current
  // Period"); the merged second band ("Year-To-Date") leaves its columns
  // carrying just the period label, so the keyword pass above never claims them
  // and the whole YTD set is dropped. Map those columns to value types
  // positionally, mirroring a fully-labeled period's column offsets.
  inferUnlabeledPeriodColumns(columns, account, byPeriod, seen, valueIndexes)

  const priority = ['current', 'ytd']
  const ordered = [
    ...priority.filter((p) => byPeriod.has(p)),
    ...seen.filter((p) => !priority.includes(p))
  ]

  return {
    account,
    sets: ordered.map((period) => ({ period, columns: byPeriod.get(period) }))
  }
}
