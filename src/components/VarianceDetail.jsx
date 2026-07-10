import React, { useState } from 'react'
import {
  PERIOD_SCOPE_LABEL,
  PERIOD_SCOPE_OPTIONS,
  PERIOD_SCOPE_HELP
} from '../lib/narrative/periodScope.js'
import { VARIANCE_INCLUDE_FILTERS, VARIANCE_IGNORE_FILTERS } from '../lib/uiControls.js'
import { cleanProfileName, MAX_PROFILE_NAME_LENGTH } from '../lib/profiles.js'

// The Include/Ignore filters are planned but NOT yet wired into the variance
// engine, so Phase 22.2 renders them disabled and flagged "Coming soon" instead
// of implying behavior they don't have. (The free-form narrative-detail select
// was removed entirely.) The lists live in src/lib/uiControls.js, shared w/ tests.
//
// Property profiles: the thresholds above can be saved under a property name
// ("1045 Sansome") and re-applied from a dropdown — or auto-applied when a base
// report for that property is uploaded (see App + src/lib/profiles.js, where
// ALL profile logic lives). This component only renders the controls: applying,
// saving, and deleting all flow through App's handlers, and an applied profile
// writes through the SAME setVariance path as typing the numbers, so previews
// and result freshness react identically. The only state held here is the
// save-form's draft name — pure form scratch, meaningless to the app.

export default function VarianceDetail({
  variance,
  setVariance,
  periodScope,
  setPeriodScope,
  periodScopeOffered = false,
  profiles = [],
  selectedProfileName = '',
  onApplyProfile,
  onSaveProfile,
  onDeleteProfile
}) {
  const set = (key, value) => setVariance((prev) => ({ ...prev, [key]: value }))
  const [draftName, setDraftName] = useState('')
  const profilesWired = typeof onApplyProfile === 'function'

  const saveDraft = () => {
    if (typeof onSaveProfile !== 'function') return
    if (onSaveProfile(draftName)) setDraftName('')
  }

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

        {profilesWired && (
          <fieldset className="checkgroup profile-group">
            <legend>Property profile</legend>
            <label className="field">
              <span className="field-label">Apply saved profile</span>
              <select
                className="field-control"
                value={selectedProfileName}
                onChange={(e) => onApplyProfile(e.target.value)}
                disabled={!profiles.length}
              >
                <option value="">{profiles.length ? 'None' : 'No saved profiles yet'}</option>
                {profiles.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Save current thresholds as</span>
              <input
                className="field-control"
                type="text"
                maxLength={MAX_PROFILE_NAME_LENGTH}
                placeholder="e.g. 1045 Sansome"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
              />
            </label>
            <div className="profile-actions">
              <button
                type="button"
                className="profile-btn"
                onClick={saveDraft}
                disabled={!cleanProfileName(draftName)}
              >
                Save as profile
              </button>
              {selectedProfileName && (
                <button
                  type="button"
                  className="profile-btn profile-btn--danger"
                  onClick={() => onDeleteProfile(selectedProfileName)}
                  aria-label={`Delete profile ${selectedProfileName}`}
                >
                  Delete profile
                </button>
              )}
            </div>
          </fieldset>
        )}

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
