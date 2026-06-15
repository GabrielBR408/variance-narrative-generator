// --- Variance summary — Phase 8 -------------------------------------------
// Rolls the per-row comparison records up into the four headline counts the
// output contract promises. Counting only — no interpretation, no narrative.

// Returns { totalRowsReviewed, totalVariancesFound, highVarianceCount, missingDataCount }.
//   totalRowsReviewed   — data rows examined (before any were skipped/computed)
//   totalVariancesFound — comparisons with a computable variance amount
//   highVarianceCount   — comparisons that crossed a threshold
//   missingDataCount    — comparisons lacking an actual or a comparison value
export function summarize(comparisons = [], rowsReviewed = null) {
  let totalVariancesFound = 0
  let highVarianceCount = 0
  let missingDataCount = 0

  for (const c of comparisons) {
    if (c.varianceAmount !== null && c.varianceAmount !== undefined) totalVariancesFound++
    if (c.thresholdTriggered) highVarianceCount++
    if (c.missingData) missingDataCount++
  }

  return {
    totalRowsReviewed:
      typeof rowsReviewed === 'number' ? rowsReviewed : comparisons.length,
    totalVariancesFound,
    highVarianceCount,
    missingDataCount
  }
}
