import React from 'react'
import {
  PERIOD_SCOPE_LABEL,
  PERIOD_SCOPE_OPTIONS,
  PERIOD_SCOPE_HELP
} from '../lib/narrative/periodScope.js'
import { VARIANCE_INCLUDE_FILTERS, VARIANCE_IGNORE_FILTERS } from '../lib/uiControls.js'

// The Include/Ignore filters are planned but NOT yet wired into the variance
// engine, so Phase 22.2 renders them disabled and flagged "Coming soon" instead
// of implying behavior they don't have. (The free-form narrative-detail select
// was removed entirely.) The lists live in src/lib/uiControls.js, shared w/ tests.

export default function VarianceDetail({
  variance,
  setVariance,
  periodScope,
  setPeriodScope,
  periodScopeOffered = false
}) {
  const set = (key, value) => setVariance((prev) => ({ ...prev, [key]: value }))

  return (
    <details className="step step--panel">
      <summary>
        <span className="step-eyebrow">Step 3</span>
        <span className="step-title">Variance Detail</span>
        <span className="step-note">Control what gets discussed.</span>
      </summary>
      <div className="panel-body">
        <p className="panel-note">
          A line is flagged when it crosses <strong>either</strong> threshold —
          the dollar amount <strong>or</strong> the percentage.
        </p>

        <label className="field">
          <span className="field-label">Dollar Threshold</span>
          <input
            className="field-control"
            type="number"
            min="0"
            step="500"
            value={variance.dollarThreshold}
            onChange={(e) => set('dollarThreshold', e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">Percentage Threshold</span>
          <input
            className="field-control"
            type="number"
            min="0"
            max="100"
            step="1"
            value={variance.percentThreshold}
            onChange={(e) => set('percentThreshold', e.target.value)}
          />
        </label>

        {periodScopeOffered && (
          <>
            <label className="field">
              <span className="field-label">{PERIOD_SCOPE_LABEL}</span>
              <select
                className="field-control"
                value={periodScope}
                onChange={(e) => setPeriodScope(e.target.value)}
              >
                {PERIOD_SCOPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="panel-note">{PERIOD_SCOPE_HELP}</p>
          </>
        )}

        <fieldset className="checkgroup checkgroup--coming-soon">
          <legend>Include <span className="coming-soon-tag">Coming soon</span></legend>
          {VARIANCE_INCLUDE_FILTERS.map((c) => (
            <label className="field field--check field--coming-soon" key={c.key}>
              <input type="checkbox" checked={variance.include[c.key]} disabled aria-disabled="true" readOnly />
              <span className="field-label">{c.label}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="checkgroup checkgroup--coming-soon">
          <legend>Ignore <span className="coming-soon-tag">Coming soon</span></legend>
          {VARIANCE_IGNORE_FILTERS.map((c) => (
            <label className="field field--check field--coming-soon" key={c.key}>
              <input type="checkbox" checked={variance.ignore[c.key]} disabled aria-disabled="true" readOnly />
              <span className="field-label">{c.label}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </details>
  )
}
