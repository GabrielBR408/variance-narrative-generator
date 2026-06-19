import React, { useMemo, useState } from 'react'
import { DEFAULT_THRESHOLDS } from '../lib/variance/thresholds.js'
import { buildVariancePreview } from '../lib/previewNarrative.js'
import { formatMoney } from '../lib/narrative/formatters.js'
import PeriodTabs from './PeriodTabs.jsx'

// --- Variance preview — Phase 8 / 22.1 ------------------------------------
// Presentation only. It renders the deterministic variance engine's output as a
// collapsed, capped table. All math lives in src/lib/variance; this component
// never calculates inline, never generates text, and never persists anything.
//
// Phase 22.1: variance is computed for the BASE report only. Supporting files
// (GL / Budget / Prior / …) are listed as enrichment context but never get a
// variance table, so a supporting file can never read as a variance driver. The
// preview uses the user's CURRENT thresholds, matching the generate path.

const PREVIEW_ROWS = 12 // bound the rendered rows; calculation already capped upstream

const REASON_MSG = {
  'not-extracted': 'This file hasn’t been extracted, so no variance can be computed.',
  'not-tabular': 'No table was found in this file, so there’s nothing to compare.',
  'no-comparable-columns':
    'Couldn’t find an Actual column plus a Budget or Prior column to compare.'
}

// Signed percent with an em-dash fallback. Kept local: the shared
// formatAbsPercent is unsigned and returns null (not '—'), so it is not an
// equivalent substitute here. (Money formatting uses the shared formatMoney.)
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
                <td className="variance-num">{formatMoney(c.actual)}</td>
                <td className="variance-num">{formatMoney(comp.value)}</td>
                <td className="variance-num">{formatMoney(c.varianceAmount)}</td>
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

const PERIOD_LABELS = { current: 'Current', ytd: 'YTD' }

function periodLabel(period) {
  return PERIOD_LABELS[period] || period
}

function VarianceItem({ result }) {
  // Prefer per-period sets when present; otherwise fall back to the flat
  // top-level shape so older/empty results still render unchanged.
  const sets =
    Array.isArray(result.comparisonSets) && result.comparisonSets.length > 0
      ? result.comparisonSets
      : [
          {
            period: 'current',
            comparisons: result.comparisons,
            summary: result.summary,
            confidence: result.confidence
          }
        ]

  // Only offer the toggle when there is more than one period to switch between.
  const hasMultiplePeriods = sets.length > 1
  const [period, setPeriod] = useState('current')
  const active = sets.find((s) => s.period === period) || sets[0]

  const { summary, confidence } = active
  const comparisons = active.comparisons || []
  const hasComparisons = comparisons.length > 0

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
            {hasMultiplePeriods && (
              <PeriodTabs
                tabs={sets.map((s) => ({ period: s.period, label: periodLabel(s.period) }))}
                active={active.period}
                onSelect={setPeriod}
              />
            )}
            <div className="variance-stats">
              <span>Rows reviewed <strong>{summary.totalRowsReviewed}</strong></span>
              <span>Variances <strong>{summary.totalVariancesFound}</strong></span>
              <span>Flagged <strong>{summary.highVarianceCount}</strong></span>
              <span>Missing data <strong>{summary.missingDataCount}</strong></span>
              <span>Confidence <strong>{confidence}%</strong></span>
            </div>
            <VarianceTable comparisons={comparisons} />
            {comparisons.length > PREVIEW_ROWS && (
              <p className="variance-more">
                Showing {PREVIEW_ROWS} of {comparisons.length} comparisons.
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

// A supporting file line: visible for context, explicitly NOT variance-computed.
function SupportingItem({ extraction }) {
  return (
    <div className="variance variance--supporting">
      <div className="variance-summary">
        <span className="variance-name">{extraction.fileName}</span>
        {extraction.classification && extraction.classification.type && (
          <span className="variance-class">{extraction.classification.type}</span>
        )}
        <span className="variance-badge variance-badge--support">Enriches narrative</span>
      </div>
    </div>
  )
}

// `items` is the ordered list of extraction objects (same list the extraction
// preview renders). Phase 22.1: variance is computed for the BASE report only,
// using the user's current `thresholds`; supporting files are listed without a
// variance table. Memoized so it recomputes the instant a threshold changes.
export default function VariancePreview({ items, thresholds = DEFAULT_THRESHOLDS }) {
  const { base, supporting } = useMemo(
    () => buildVariancePreview({ items, thresholds }),
    [items, thresholds]
  )

  // Nothing extracted yet, or no base report uploaded → no variance to preview.
  if (!base && supporting.length === 0) return null

  return (
    <div className="card variance-card">
      <div className="card-label">Variance Preview</div>
      <p className="card-sub">
        Actual vs. Budget/Prior for the base report, calculated in your browser. Thresholds:{' '}
        {formatMoney(thresholds.amount)} or {thresholds.percent}%. Supporting files enrich the
        narrative and are not variance-computed. Preview only — nothing is saved or sent.
      </p>
      <div className="variance-list">
        {base ? (
          <VarianceItem result={base.variance} />
        ) : (
          <p className="variance-msg">
            No base report yet. Upload a Base Variance Report to compute variances.
          </p>
        )}
        {supporting.map((ex) => (
          <SupportingItem key={ex.fileId} extraction={ex} />
        ))}
      </div>
    </div>
  )
}
