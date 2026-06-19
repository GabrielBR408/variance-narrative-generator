import React, { useRef, useState } from 'react'
import { classifyFile, confidenceTier } from '../lib/classify.js'
import { routeUpload } from '../lib/uploadRouting.js'
import { DEFAULT_THRESHOLDS } from '../lib/variance/thresholds.js'
import ExtractionPreview from './ExtractionPreview.jsx'
import PreviewBasis from './PreviewBasis.jsx'
import VariancePreview from './VariancePreview.jsx'
import NarrativeSummary from './NarrativeSummary.jsx'

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

export default function SourceFiles({
  baseReport,
  setBaseReport,
  supportingFiles,
  setSupportingFiles,
  extractions = {},
  fileKey,
  periodScope,
  commentaryMode = 'detailed',
  thresholds = DEFAULT_THRESHOLDS
}) {
  const fileInput = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  // Transient confirmation message describing the last routing decision (e.g.
  // a base report being identified or replaced). Cleared when files are removed.
  const [notice, setNotice] = useState('')

  // Ordered extraction items (base first), if extraction is wired in.
  const orderedFiles = []
  if (baseReport) orderedFiles.push(baseReport)
  supportingFiles.forEach((f) => orderedFiles.push(f))
  const previewItems = fileKey
    ? orderedFiles.map((f) => extractions[fileKey(f)]).filter(Boolean)
    : []

  // Single entry point for every file the user drops or selects. The existing
  // filename classifier decides which file (if any) is the base variance report
  // and which are supporting; validation/extraction downstream are unchanged.
  const acceptFiles = (incoming) => {
    const files = Array.from(incoming || [])
    if (!files.length) return
    const routed = routeUpload({
      incoming: files,
      currentBase: baseReport,
      currentSupporting: supportingFiles
    })
    setBaseReport(routed.base)
    setSupportingFiles(routed.supporting)
    setNotice(routed.notice)
  }

  const onPick = (e) => {
    acceptFiles(e.target.files)
    e.target.value = ''
  }
  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    acceptFiles(e.dataTransfer?.files)
  }
  const onDragOver = (e) => {
    e.preventDefault()
    setDragOver(true)
  }
  const onDragLeave = (e) => {
    e.preventDefault()
    setDragOver(false)
  }

  const removeBase = () => {
    setBaseReport(null)
    setNotice('')
  }
  const removeSupport = (idx) => {
    setSupportingFiles((prev) => prev.filter((_, i) => i !== idx))
    setNotice('')
  }

  const hasFiles = !!baseReport || supportingFiles.length > 0

  return (
    <section className="step step--source">
      <div className="step-head">
        <span className="step-eyebrow">Step 1</span>
        <h2 className="step-title">Source Files</h2>
      </div>

      <div className="card card--primary">
        <div className="card-label">Upload your files</div>
        <p className="card-sub">
          Drop the base variance report and any supporting files together — we'll sort out which
          is which. The base is typically a comparative income statement, ideally in Excel.
        </p>

        <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={onPick} />
        <button
          type="button"
          className={`dropzone${dragOver ? ' dropzone--over' : ''}`}
          onClick={() => fileInput.current?.click()}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          <span className="dropzone-title">Drag &amp; drop files here</span>
          <span className="dropzone-sub">or click to choose — you can add several at once</span>
        </button>

        {notice && <p className="upload-notice" role="status">{notice}</p>}

        {hasFiles && (
          <div className="upload-groups">
            <div className="upload-group">
              <div className="upload-group-label">Base Variance Report</div>
              {baseReport ? (
                <div className="chips">
                  <Chip file={baseReport} role="baseReport" onRemove={removeBase} />
                </div>
              ) : (
                <p className="upload-group-empty">No base report yet — drop a variance report above.</p>
              )}
            </div>

            <div className="upload-group">
              <div className="upload-group-label">Supporting Files</div>
              {supportingFiles.length > 0 ? (
                <div className="chips">
                  {supportingFiles.map((f, i) => (
                    <Chip key={`${f.name}-${i}`} file={f} role="supportingFile" onRemove={() => removeSupport(i)} />
                  ))}
                </div>
              ) : (
                <p className="upload-group-empty">No supporting files yet.</p>
              )}
            </div>
          </div>
        )}

        <details className="helper">
          <summary>What can I add here?</summary>
          <ul className="helper-list">
            {CATEGORIES.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </details>
      </div>

      <PreviewBasis items={previewItems} />
      <ExtractionPreview items={previewItems} />
      <VariancePreview items={previewItems} thresholds={thresholds} />
      <NarrativeSummary
        items={previewItems}
        periodScope={periodScope}
        commentaryMode={commentaryMode}
        thresholds={thresholds}
      />
    </section>
  )
}
