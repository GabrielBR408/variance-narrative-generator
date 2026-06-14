import React, { useRef } from 'react'
import { classifyFile, confidenceTier } from '../lib/classify.js'

const ACCEPT = '.pdf,.xlsx,.xls,.csv,.docx'
const CATEGORIES = [
  'General Ledger (GL)',
  'Budget',
  'Prior Month Report',
  'Existing Variance Report',
  'Owner Report Example',
  'Supporting Documents'
]

function prettySize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Chip({ file, role, onRemove }) {
  // Classification is purely advisory and computed from name + role only.
  // It never gates the upload; the file is already here regardless.
  const { type, confidence } = classifyFile({ name: file.name, role })
  return (
    <span className="chip">
      <span className="chip-top">
        <span className="chip-name">{file.name}</span>
        <span className="chip-size">{prettySize(file.size)}</span>
        <button type="button" className="chip-x" aria-label={`Remove ${file.name}`} onClick={onRemove}>
          ×
        </button>
      </span>
      <span className={`chip-class chip-class--${confidenceTier(confidence)}`}>
        <span className="chip-class-type">{type}</span>
        <span className="chip-class-conf">{confidence}%</span>
      </span>
    </span>
  )
}

export default function SourceFiles({ baseReport, setBaseReport, supportingFiles, setSupportingFiles }) {
  const baseInput = useRef(null)
  const supportInput = useRef(null)

  const onBase = (e) => {
    const f = e.target.files?.[0]
    if (f) setBaseReport(f)
    e.target.value = ''
  }
  const onSupport = (e) => {
    const incoming = Array.from(e.target.files || [])
    if (incoming.length) setSupportingFiles((prev) => [...prev, ...incoming])
    e.target.value = ''
  }
  const removeSupport = (idx) =>
    setSupportingFiles((prev) => prev.filter((_, i) => i !== idx))

  return (
    <section className="step step--source">
      <div className="step-head">
        <span className="step-eyebrow">Step 1</span>
        <h2 className="step-title">Source Files</h2>
      </div>

      <div className="card card--primary">
        <div className="card-label">Upload Base Variance Report</div>
        <p className="card-sub">Upload the report to use as the base.</p>

        <input ref={baseInput} type="file" accept={ACCEPT} hidden onChange={onBase} />
        <button type="button" className="dropzone" onClick={() => baseInput.current?.click()}>
          {baseReport ? 'Replace base report' : 'Choose a file'}
        </button>

        {baseReport && (
          <div className="chips">
            <Chip file={baseReport} role="baseReport" onRemove={() => setBaseReport(null)} />
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-label">Add Supporting Files</div>
        <p className="card-sub">Optional context the narrative can draw on.</p>

        <input ref={supportInput} type="file" accept={ACCEPT} multiple hidden onChange={onSupport} />
        <button type="button" className="dropzone dropzone--sm" onClick={() => supportInput.current?.click()}>
          Add files
        </button>

        {supportingFiles.length > 0 && (
          <div className="chips">
            {supportingFiles.map((f, i) => (
              <Chip key={`${f.name}-${i}`} file={f} role="supportingFile" onRemove={() => removeSupport(i)} />
            ))}
          </div>
        )}

        <details className="helper">
          <summary>What can I add here?</summary>
          <ul className="helper-list">
            {CATEGORIES.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </details>
      </div>
    </section>
  )
}
