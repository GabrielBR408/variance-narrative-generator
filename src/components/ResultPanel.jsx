import React from 'react'

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

function prettySize(bytes) {
  if (typeof bytes !== 'number') return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function ResultPanel({ status, result }) {
  const showResult = status === 'success' && result
  const files = (showResult && Array.isArray(result.files)) ? result.files : []

  return (
    <section className="step step--result" aria-live="polite">
      <div className="step-head">
        <span className="step-eyebrow">Result</span>
        <h2 className="step-title">Narrative Summary</h2>
        <span className={`status-pill status-pill--${status}`}>{STATUS_TEXT[status]}</span>
      </div>

      {!showResult ? (
        <p className="result-empty">
          Nothing generated yet. Add a base report, choose your settings, and select
          Generate Narrative — the summary will appear here.
        </p>
      ) : (
        <>
          <div className="result">
            <div className="result-row"><span>Status</span><strong>Complete</strong></div>
            <div className="result-row"><span>Job ID</span><strong>{result.jobId}</strong></div>
            <div className="result-row"><span>Files Received</span><strong>{result.filesReceived}</strong></div>
            <div className="result-row"><span>Settings Received</span><strong>{result.settingsReceived ? 'Yes' : 'No'}</strong></div>
          </div>

          {files.length > 0 && (
            <ul className="received-files">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="received-file">
                  <div className="received-file-head">
                    <span className="received-file-name">{f.name}</span>
                    <span className={`received-file-role received-file-role--${f.role}`}>
                      {ROLE_LABEL[f.role] || f.role}
                    </span>
                  </div>
                  <div className="received-file-meta">
                    <span>{prettySize(f.size)}</span>
                    <span>{f.type || 'unknown type'}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="narrative">
            <div className="narrative-label">Narrative</div>
            <p className="narrative-body">{result.summary}</p>
            <p className="narrative-note">Analysis engine not connected yet.</p>
          </div>
        </>
      )}
    </section>
  )
}
