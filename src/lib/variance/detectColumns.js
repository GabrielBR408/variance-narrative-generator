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
  for (const [type, patterns] of COLUMN_PATTERNS) {
    if (patterns.some((re) => re.test(h))) return type
  }
  return null
}

// Locate the account label column. Prefer an explicitly named header; otherwise
// fall back to the first column that reads as mostly text across the data rows
// (account names are non-numeric), and finally to column 0.
function detectAccountColumn(columns, rows, valueIndexes) {
  for (let i = 0; i < columns.length; i++) {
    if (ACCOUNT_RE.test(String(columns[i]))) return i
  }

  const taken = new Set(valueIndexes)
  const sample = rows.slice(0, 50) // bounded scan keeps detection O(columns)
  let best = -1
  let bestTextScore = -1
  for (let i = 0; i < columns.length; i++) {
    if (taken.has(i)) continue
    let text = 0
    let seen = 0
    for (const row of sample) {
      const cell = Array.isArray(row) ? row[i] : undefined
      if (cell === undefined || cell === null || String(cell).trim() === '') continue
      seen++
      // Non-numeric cells signal a label column.
      if (!/^[\s$()%-]*\d/.test(String(cell).trim())) text++
    }
    const score = seen === 0 ? 0 : text / seen
    if (score > bestTextScore) {
      bestTextScore = score
      best = i
    }
  }
  return best >= 0 ? best : 0
}

// Returns { account, actual, budget, prior } as column indexes, each null when
// absent. `rows` is only used to locate the label column when headers don't.
export function detectColumns(columns = [], rows = []) {
  const result = { account: null, actual: null, budget: null, prior: null }
  if (!Array.isArray(columns) || columns.length === 0) return result

  const valueIndexes = []
  columns.forEach((header, i) => {
    const type = matchType(header)
    // First column to claim a value type wins; later duplicates are ignored.
    if (type && result[type] === null) {
      result[type] = i
      valueIndexes.push(i)
    }
  })

  result.account = detectAccountColumn(columns, rows, valueIndexes)
  return result
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
// column to claim a value type wins, mirroring detectColumns.
export function detectComparisonSets(columns = [], rows = []) {
  if (!Array.isArray(columns) || columns.length === 0) {
    return { account: null, sets: [] }
  }

  // Block-aware grouping. A comparative statement lays its periods out as
  // repeating value blocks ("Actual | Budget | … " once per period). We split
  // those blocks so each period is detected on its own — even when the periods
  // are NOT distinguished by a "Current"/"YTD" label (a flat header row that
  // simply repeats "Actual | Budget | …", which the merged period band above it
  // did not survive as). A new block starts whenever a value type repeats (a
  // SECOND "Actual" begins the next period) or the explicit period label changes.
  const blocks = [] // [{ explicit, set: { actual, budget, prior } }]
  let block = null
  const valueIndexes = []

  columns.forEach((header, i) => {
    const type = matchType(header)
    if (!type) return
    const ep = explicitPeriod(header)
    const startNew =
      block === null ||
      block.set[type] !== null ||
      (ep && block.explicit && ep !== block.explicit)
    if (startNew) {
      block = { explicit: ep || null, set: { actual: null, budget: null, prior: null } }
      blocks.push(block)
    } else if (ep && !block.explicit) {
      block.explicit = ep
    }
    block.set[type] = i
    valueIndexes.push(i)
  })

  // Resolve each block to a period: an explicitly labeled block keeps its label;
  // the rest fall back to position (first block → current, second → ytd, …),
  // skipping any period an explicit label already claimed.
  const byPeriod = new Map() // period -> { actual, budget, prior } indexes
  const seen = [] // periods in first-seen order
  const used = new Set()
  for (const b of blocks) {
    if (b.explicit) used.add(b.explicit)
  }
  const fallback = ['current', 'ytd']
  let fi = 0
  for (const b of blocks) {
    let period = b.explicit
    if (!period) {
      while (fi < fallback.length && used.has(fallback[fi])) fi++
      period = fi < fallback.length ? fallback[fi++] : `period${blocks.indexOf(b) + 1}`
      used.add(period)
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
  }

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
