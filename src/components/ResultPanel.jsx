import React, { useState, useEffect } from 'react'
import { classifyFile, confidenceTier } from '../lib/classify.js'
import { canExport } from '../lib/export/exportState.js'
import { freshnessBannerVisible } from '../lib/generateState.js'
import { scopeNarrative, DEFAULT_PERIOD_SCOPE } from '../lib/narrative/periodScope.js'
import { OWNER_SECTIONS, CONTEXT_SECTION } from '../lib/narrative/sectionDefs.js'
import { prettySize } from './uiFormat.js'
import ExportActions from './ExportActions.jsx'
import EnrichmentDiagnostic from './EnrichmentDiagnostic.jsx'
import EnrichmentStatus from './EnrichmentStatus.jsx'
import BackupNotice from './BackupNotice.jsx'
import PeriodTabs from './PeriodTabs.jsx'

const NO_FRESHNESS = { stale: false, changed: [] }

// Phase 22.2: a small, dismissible banner shown when the displayed result was
// generated with settings that have since changed (thresholds or commentary
// mode), so the user knows the result/exports are out of date until they
// regenerate. Pure visibility rule lives in generateState.freshnessBannerVisible;
// dismissal is local and re-arms whenever a NEW change occurs.
function ResultFreshnessBanner({ status, hasResult, freshness }) {
  const changedKey = (freshness.changed || []).join(',')
  const [dismissed, setDismissed] = useState(false)
  // Re-show the banner whenever the set of changed settings changes.
  useEffect(() => setDismissed(false), [changedKey])

  if (!freshnessBannerVisible({ status, hasResult, stale: freshness.stale, dismissed })) return null

  return (
    <div className="freshness-banner" role="status">
      <span className="freshness-banner-text">
        Results were generated with previous settings. Regenerate to refresh exports and narratives.
      </span>
      <button
        type="button"
        className="freshness-banner-x"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  )
}

const STATUS_TEXT = {
  idle: 'Idle',
  preparing: 'Preparing request',
  sending: 'Sending to generator',
  success: 'Generation complete',
  failure: 'Generation failed'
}

const ROLE_LABEL = {
  baseReport: 'Base Variance Report',
  supportingFile: 'Supporting File'
}

export default function ResultPanel({ status, result, periodScope = DEFAULT_PERIOD_SCOPE, freshness = NO_FRESHNESS }) {
  const showResult = status === 'success' && result
  const files = (showResult && Array.isArray(result.files)) ? result.files : []
  // Phase 15.1: apply the selected period scope as a pure view transform over the
  // (already enriched) generated narrative. This is identity unless the report
  // carries both Current and YTD periods, so it both renders and exports exactly
  // what the live preview showed for the same selection.
  const scopedNarrative = showResult ? scopeNarrative(result.narrative, periodScope) : null

  return (
    <section className="step step--result" aria-live="polite">
      <div className="step-head">
        <span className="step-eyebrow">Result</span>
        <h2 className="step-title">Generated Narrative</h2>
        <span className={`status-pill status-pill--${status}`}>{STATUS_TEXT[status]}</span>
      </div>

      {!showResult ? (
        <p className="result-empty">
          Nothing generated yet. Add a base report, choose your settings, and select
          Generate Narrative — the finished narrative will appear here. The cards above
          are a live preview only.
        </p>
      ) : (
        <>
          <ResultFreshnessBanner status={status} hasResult={!!result} freshness={freshness} />

          <div className="result">
            <div className="result-row"><span>Status</span><strong>Complete</strong></div>
            <div className="result-row"><span>Job ID</span><strong>{result.jobId}</strong></div>
            <div className="result-row"><span>Files Received</span><strong>{result.filesReceived}</strong></div>
            <div className="result-row"><span>Settings Received</span><strong>{result.settingsReceived ? 'Yes' : 'No'}</strong></div>
          </div>

          {files.length > 0 && (
            <ul className="received-files">
              {files.map((f, i) => {
                // Deterministic, content-free classification from name + role.
                const { type, confidence } = classifyFile({ name: f.name, role: f.role })
                return (
                  <li key={`${f.name}-${i}`} className="received-file">
                    <div className="received-file-head">
                      <span className="received-file-name">{f.name}</span>
                      <span className={`received-file-role received-file-role--${f.role}`}>
                        {ROLE_LABEL[f.role] || f.role}
                      </span>
                    </div>
                    <div className="received-file-class">
                      <span className="received-file-class-label">Detected</span>
                      <span className="received-file-class-type">{type}</span>
                      <span className={`received-file-class-conf received-file-class-conf--${confidenceTier(confidence)}`}>
                        {confidence}% confidence
                      </span>
                    </div>
                    <div className="received-file-meta">
                      <span>{prettySize(f.size)}</span>
                      <span>{f.type || 'unknown type'}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {result.diagnostic && <EnrichmentDiagnostic diagnostic={result.diagnostic} />}

          {/* Fix A: honest AI-enrichment status for this generation (near the
              output and download buttons), so the user knows when a basic
              narrative is shown and why. */}
          <EnrichmentStatus enrichment={result.enrichment} />

          {/* Input-guidance phase: recommends a supporting input that would have
              strengthened the commentary (presence/type only). Renders nothing
              when every needed input was present. */}
          <BackupNotice notice={result.backup} />

          <ResultNarrative narrative={scopedNarrative} />

          {canExport({ status, narrative: scopedNarrative }) && (
            <ExportActions narrative={scopedNarrative} enrichment={result.enrichment} />
          )}
        </>
      )}
    </section>
  )
}

// The fixed five owner sections plus the NQ-3C Context Notes catch-all; this
// view already omits empty sections, so Context Notes shows only when it carries
// re-homed rows.
const SECTIONS = [...OWNER_SECTIONS, CONTEXT_SECTION]

// Renders the deterministic narrative returned by /generate. Presentation only —
// every sentence is produced by the server's narrative engine; nothing here
// invents or reformats figures.
function ResultNarrative({ narrative }) {
  const periods = narrative && Array.isArray(narrative.periods) ? narrative.periods : []
  const [period, setPeriod] = useState(periods[0]?.period || 'current')

  if (periods.length === 0) {
    return (
      <div className="narrative">
        <div className="narrative-label">Narrative</div>
        <p className="result-empty">
          No comparable variance data was found in the base report, so there is nothing to narrate.
        </p>
      </div>
    )
  }

  const active = periods.find((p) => p.period === period) || periods[0]
  const hasMultiplePeriods = periods.length > 1

  return (
    <div className="narrative">
      <div className="narrative-label">Narrative</div>
      {hasMultiplePeriods && (
        <PeriodTabs
          tabs={periods.map((p) => ({ period: p.period, label: p.periodLabel }))}
          active={active.period}
          onSelect={setPeriod}
        />
      )}
      {SECTIONS.map(({ key, title }) => {
        const notes = Array.isArray(active[key]) ? active[key] : []
        if (notes.length === 0) return null
        return (
          <div key={key} className="narrative-section">
            <h4 className="narrative-section-title">{title}</h4>
            <ul className="narrative-notes">
              {notes.map((n, i) => (
                <li key={i} className="narrative-note">{n.text}</li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
