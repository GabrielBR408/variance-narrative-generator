// --- Row alignment — Phase 8 ----------------------------------------------
// Turns the normalized grid into one tidy record per data row, pulling the
// account label and the actual / budget / prior values out of their detected
// columns. This is the "align actual against its comparison" step — alignment
// across columns within a row, not summing or reshaping the data.
//
// Numeric parsing is delegated to the Phase 7 normalizer's toNumber so cells
// read identically to how they were extracted. No math, no thresholds here.

import { toNumber } from '../extract/normalize.js'

function cellAt(row, index) {
  if (index === null || index === undefined) return null
  return Array.isArray(row) ? row[index] : undefined
}

function valueAt(row, index) {
  const cell = cellAt(row, index)
  return cell === undefined || cell === null ? null : toNumber(cell)
}

// Returns an ordered list of aligned records:
//   { account, actual, budget, prior, sourceRows }
// One record per qualifying data row. Rows with no label and no numeric value
// are skipped (blank/spacer rows). `sourceRows` carries the originating data-row
// index for traceability back to the preview. Linear in the number of rows.
export function alignRows(rows = [], indexes = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return []
  const { account, actual, budget, prior } = indexes
  const aligned = []

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (!Array.isArray(row)) continue

    const label =
      account === null || account === undefined ? '' : String(cellAt(row, account) ?? '').trim()
    const actualVal = valueAt(row, actual)
    const budgetVal = valueAt(row, budget)
    const priorVal = valueAt(row, prior)

    // A data row needs at least one number. Label-only rows are section headers
    // or spacers, not comparisons; rows missing only one side (e.g. actual but
    // not budget) are kept and reported as missing data downstream.
    if (actualVal === null && budgetVal === null && priorVal === null) continue

    aligned.push({
      account: label,
      actual: actualVal,
      budget: budgetVal,
      prior: priorVal,
      sourceRows: [r]
    })
  }

  return aligned
}
