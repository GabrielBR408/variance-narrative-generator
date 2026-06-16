import React, { useMemo, useState } from 'react'
import { DEFAULT_PERIOD_SCOPE } from '../lib/narrative/periodScope.js'
import { DEFAULT_THRESHOLDS } from '../lib/variance/thresholds.js'
import { buildPreviewNarrative } from '../lib/previewNarrative.js'
import EnrichmentDiagnostic from './EnrichmentDiagnostic.jsx'

// --- Narrative Summary — Phase 9A / 21.5 ----------------------------------
// Presentation only. It mirrors the generate path: one narrative is built from
// the Base Variance Report and enriched with the supporting files, then rendered
// with the owner-ready sections and a Current / YTD toggle. Supporting files
// (GL, budget, prior, …) never produce their own preview narrative — they only
// enrich the base. All routing/math lives in src/lib/previewNarrative; this
// component generates no text. Nothing is saved, sent, or exported.

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
// preview renders). Phase 21.5: the preview mirrors the generate path — a single
// narrative is built from the Base Variance Report and enriched with the
// supporting files. With no base report there is no preview. Phase 21.4: the
// commentary mode defaults to 'detailed' (Conservative is still selectable).
export default function NarrativeSummary({
  items,
  periodScope = DEFAULT_PERIOD_SCOPE,
  commentaryMode = 'detailed',
  thresholds = DEFAULT_THRESHOLDS
}) {
  const narrative = useMemo(
    () => buildPreviewNarrative({ items, periodScope, commentaryMode, thresholds }),
    [items, periodScope, commentaryMode, thresholds]
  )

  if (!narrative) return null

  return (
    <div className="card narrative-card">
      <div className="card-label">Narrative Preview</div>
      <p className="card-sub">
        A live preview of the base report's narrative, computed in your browser and enriched with
        your supporting files — it updates as you add files. Press <strong>Generate Narrative</strong>{' '}
        to produce the final version below. Every line traces back to a source row. Nothing is saved,
        sent, or exported.
      </p>
      <EnrichmentDiagnostic extractions={items} narratives={[narrative]} />
      <div className="narrative-list">
        <NarrativeItem narrative={narrative} />
      </div>
    </div>
  )
}
