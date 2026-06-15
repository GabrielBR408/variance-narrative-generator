import React, { useMemo } from 'react'
import { computeVariance } from '../lib/variance/index.js'
import { DEFAULT_THRESHOLDS } from '../lib/variance/thresholds.js'

// --- Variance preview — Phase 8 -------------------------------------------
// Presentation only. It runs the deterministic variance engine over the
// normalized extractions and renders a collapsed, capped table per file. All
// math lives in src/lib/variance; this component never calculates inline, never
// generates text, and never persists anything.

const PREVIEW_ROWS = 12 // bound the rendered rows; calculation already capped upstream

const REASON_MSG = {
  'not-extracted': 'This file hasn’t been extracted, so no variance can be computed.',
  'not-tabular': 'No table was found in this file, so there’s nothing to compare.',
  'no-comparable-columns':
    'Couldn’t find an Actual column plus a Budget or Prior column to compare.'
}

function fmtMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}`
}

function fmtPercent(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${n.toFixed(1)}%`
}

function comparisonValue(c) {
  // Show the value that actually drove the variance (budget preferred, else prior).
  if (c.comparisonType === 'budget') return { label: 'Budget', value: c.budget }
  if (c.comparisonType === 'prior') return { label: 'Prior', value: c.prior }
  if (c.budget !== null) return { label: 'Budget', value: c.budget }
  if (c.prior !== null) return { label: 'Prior', value: c.prior }
  return { label: 'Budget/Prior', value: null }
}

function VarianceTable({ comparisons }) {
  const rows = comparisons.slice(0, PREVIEW_ROWS)
  return (
    <div className="variance-table-wrap">
      <table className="variance-table">
        <thead>
          <tr>
            <th>Account</th>
            <th>Actual</th>
            <th>Budget/Prior</th>
            <th>Variance $</th>
            <th>Variance %</th>
            <th>Category</th>
            <th>Threshold</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => {
            const comp = comparisonValue(c)
            return (
              <tr key={i} className={c.thresholdTriggered ? 'variance-row--flagged' : undefined}>
                <td>{c.account || '—'}</td>
                <td className="variance-num">{fmtMoney(c.actual)}</td>
                <td className="variance-num">{fmtMoney(comp.value)}</td>
                <td className="variance-num">{fmtMoney(c.varianceAmount)}</td>
                <td className="variance-num">{fmtPercent(c.variancePercent)}</td>
                <td>
                  <span className={`variance-cat variance-cat--${c.category}`}>{c.category}</span>
                </td>
                <td>
                  {c.thresholdTriggered ? (
                    <span className="variance-flag variance-flag--on">Triggered</span>
                  ) : (
                    <span className="variance-flag">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function VarianceItem({ result }) {
  const { summary } = result
  const hasComparisons = result.comparisons.length > 0

  return (
    <details className="variance">
      <summary className="variance-summary">
        <span className="variance-name">{result.fileName}</span>
        {result.baseClassification && (
          <span className="variance-class">{result.baseClassification}</span>
        )}
        {hasComparisons ? (
          <span className="variance-badge">
            {summary.highVarianceCount} flagged / {summary.totalVariancesFound}
          </span>
        ) : (
          <span className="variance-badge variance-badge--none">No comparison</span>
        )}
      </summary>

      <div className="variance-body">
        {hasComparisons ? (
          <>
            <div className="variance-stats">
              <span>Rows reviewed <strong>{summary.totalRowsReviewed}</strong></span>
              <span>Variances <strong>{summary.totalVariancesFound}</strong></span>
              <span>Flagged <strong>{summary.highVarianceCount}</strong></span>
              <span>Missing data <strong>{summary.missingDataCount}</strong></span>
              <span>Confidence <strong>{result.confidence}%</strong></span>
            </div>
            <VarianceTable comparisons={result.comparisons} />
            {result.comparisons.length > PREVIEW_ROWS && (
              <p className="variance-more">
                Showing {PREVIEW_ROWS} of {result.comparisons.length} comparisons.
              </p>
            )}
          </>
        ) : (
          <p className="variance-msg">{REASON_MSG[result.reason] || 'Nothing to compare.'}</p>
        )}
      </div>
    </details>
  )
}

// `items` is the ordered list of extraction objects (same list the extraction
// preview renders). Variance is computed here, in a memo, from those objects.
export default function VariancePreview({ items }) {
  const results = useMemo(() => {
    if (!items || items.length === 0) return []
    return items
      .filter((ex) => ex && ex.status === 'ok')
      .map((ex) => computeVariance(ex, DEFAULT_THRESHOLDS))
  }, [items])

  if (results.length === 0) return null

  return (
    <div className="card variance-card">
      <div className="card-label">Variance Preview</div>
      <p className="card-sub">
        Actual vs. Budget/Prior, calculated in your browser. Thresholds: $
        {DEFAULT_THRESHOLDS.amount.toLocaleString()} or {DEFAULT_THRESHOLDS.percent}%. Preview only —
        nothing is saved or sent.
      </p>
      <div className="variance-list">
        {results.map((r) => (
          <VarianceItem key={r.fileId} result={r} />
        ))}
      </div>
    </div>
  )
}
