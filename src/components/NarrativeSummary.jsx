import React, { useMemo, useState } from 'react'
import { computeVariance } from '../lib/variance/index.js'
import { DEFAULT_THRESHOLDS } from '../lib/variance/thresholds.js'
import { generateNarrative } from '../lib/narrative/index.js'
import { enrichNarrative } from '../lib/enrich/index.js'

// --- Narrative Summary — Phase 9A -----------------------------------------
// Presentation only. Runs the deterministic variance engine over the normalized
// extractions, then the narrative engine over each result, and renders the
// owner-ready sections with a Current / YTD toggle. No text is generated in this
// component — every sentence comes from src/lib/narrative. Nothing is saved,
// sent, or exported.

const SECTIONS = [
  { key: 'executiveSummary', title: 'Executive Summary' },
  { key: 'highVariances', title: 'High Variances' },
  { key: 'missingData', title: 'Missing Data' },
  { key: 'revenueNotes', title: 'Revenue Notes' },
  { key: 'expenseNotes', title: 'Expense Notes' }
]

const EMPTY_MSG = {
  executiveSummary: 'No triggered variances to summarize.',
  highVariances: 'No variances crossed the thresholds.',
  missingData: 'No missing comparisons.',
  revenueNotes: 'No revenue variances flagged.',
  expenseNotes: 'No expense variances flagged.'
}

function Section({ title, notes, emptyMsg }) {
  const items = Array.isArray(notes) ? notes : []
  return (
    <div className="narrative-section">
      <h4 className="narrative-section-title">{title}</h4>
      {items.length > 0 ? (
        <ul className="narrative-notes">
          {items.map((n, i) => (
            <li key={i} className="narrative-note">
              {n.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="narrative-empty">{emptyMsg}</p>
      )}
    </div>
  )
}

function NarrativeItem({ narrative }) {
  const periods = Array.isArray(narrative.periods) ? narrative.periods : []
  const hasMultiplePeriods = periods.length > 1
  const [period, setPeriod] = useState(periods[0]?.period || 'current')
  const active = periods.find((p) => p.period === period) || periods[0]

  if (!active) return null

  return (
    <details className="narrative">
      <summary className="narrative-summary-row">
        <span className="narrative-name">{narrative.fileName}</span>
        {narrative.classification && (
          <span className="narrative-class">{narrative.classification}</span>
        )}
      </summary>

      <div className="narrative-body">
        {hasMultiplePeriods && (
          <div className="variance-periods" role="tablist" aria-label="Comparison period">
            {periods.map((p) => (
              <button
                key={p.period}
                type="button"
                role="tab"
                aria-selected={p.period === active.period}
                className={`variance-period${p.period === active.period ? ' variance-period--on' : ''}`}
                onClick={() => setPeriod(p.period)}
              >
                {p.periodLabel}
              </button>
            ))}
          </div>
        )}

        {SECTIONS.map(({ key, title }) => (
          <Section key={key} title={title} notes={active[key]} emptyMsg={EMPTY_MSG[key]} />
        ))}
      </div>
    </details>
  )
}

// `items` is the ordered list of extraction objects (same list the variance
// preview renders). Variance → narrative is computed here, in a memo.
export default function NarrativeSummary({ items }) {
  const narratives = useMemo(() => {
    if (!items || items.length === 0) return []
    const ok = items.filter((ex) => ex && ex.status === 'ok')
    return ok
      .map((ex) => {
        const variance = computeVariance(ex, DEFAULT_THRESHOLDS)
        const narrative = generateNarrative(variance)
        // Phase 15: enrich with every OTHER uploaded file as supporting evidence,
        // so the preview matches the enriched result the generate flow produces.
        const supporting = ok.filter((o) => o !== ex)
        return enrichNarrative(narrative, { supporting })
      })
      // Only surface files that actually produced at least one comparable period.
      .filter((n) => Array.isArray(n.periods) && n.periods.length > 0)
  }, [items])

  if (narratives.length === 0) return null

  return (
    <div className="card narrative-card">
      <div className="card-label">Narrative Preview</div>
      <p className="card-sub">
        A live preview computed in your browser from the variance results above — it updates as you
        add files. Press <strong>Generate Narrative</strong> to produce the final version below.
        Every line traces back to a source row. Nothing is saved, sent, or exported.
      </p>
      <div className="narrative-list">
        {narratives.map((n) => (
          <NarrativeItem key={n.fileId} narrative={n} />
        ))}
      </div>
    </div>
  )
}
