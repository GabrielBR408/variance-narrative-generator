import React from 'react'

const STATUS_TEXT = {
  idle: 'Idle',
  preparing: 'Preparing request',
  sending: 'Sending to generator',
  success: 'Generation complete',
  failure: 'Generation failed'
}

export default function ResultPanel({ status, result }) {
  const showResult = status === 'success' && result

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
