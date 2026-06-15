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
