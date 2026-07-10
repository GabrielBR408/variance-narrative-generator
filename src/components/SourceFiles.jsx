import React, { useRef, useState } from 'react'
import { classifyFile, confidenceTier } from '../lib/classify.js'
import { routeUpload } from '../lib/uploadRouting.js'
import { fileKey } from '../lib/fileKey.js'
import { prettySize, friendlyFileType } from './uiFormat.js'
import { track } from '../lib/track.js'

const ACCEPT = '.pdf,.xlsx,.xls,.csv,.docx'

function Chip({ file, role, extraction, onRemove }) {
  // The label is advisory. Before extraction it is the name/role guess; once a
  // NON-BASE file has been parsed and CONTENT reclassified it (basis 'content' —
  // e.g. a budget exported with a GL-ish filename), show the corrected type so the
  // file list reflects what will actually be mined. Display-only: this never feeds
  // base selection or variance, which read the name/role classifier directly.
  const filename = classifyFile({ name: file.name, role })
  const refined = extraction && extraction.classification
  const { type, confidence } =
    refined && refined.basis === 'content' ? refined : filename
  // A file the extractor refused ('unsupported' reason — e.g. a dragged .txt,
  // which bypasses the picker's accept filter) must not wear a confident role
  // badge ("Base Variance Report 100%") while extraction says it can't be read.
  // Show an honest "Unsupported file" badge instead.
  const unsupported = Boolean(
    extraction && (extraction.reason === 'unsupported' || extraction.status === 'unsupported')
  )
  return (
    <span className="chip">
      <span className="chip-top">
        <span className="chip-name">{file.name}</span>
        <span className="chip-size">{prettySize(file.size)} · {friendlyFileType(file.type, file.name)}</span>
        <button type="button" className="chip-x" aria-label={`Remove ${file.name}`} onClick={onRemove}>
          ×
        </button>
      </span>
      {unsupported ? (
        <span className="chip-class chip-class--unsupported">
          <span className="chip-class-type">Unsupported file</span>
        </span>
      ) : (
        <span className={`chip-class chip-class--${confidenceTier(confidence)}`}>
          <span className="chip-class-type">{type}</span>
          <span className="chip-class-conf">{confidence}%</span>
        </span>
      )}
    </span>
  )
}

export default function SourceFiles({
  baseReport,
  setBaseReport,
  supportingFiles,
  setSupportingFiles,
  extractions = {}
}) {
  const fileInput = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  // Transient confirmation message describing the last routing decision (e.g.
  // a base report being identified or replaced). Cleared when files are removed.
  const [notice, setNotice] = useState('')

  // Single entry point for every file the user drops or selects. The existing
  // filename classifier decides which file (if any) is the base variance report
  // and which are supporting; validation/extraction downstream are unchanged.
  const acceptFiles = (incoming) => {
    const files = Array.from(incoming || [])
    if (!files.length) return
    track('vng', 'files_uploaded', { count: files.length })
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

        {/* Short default-view guidance (the detailed note lives in the Settings
            & instructions panel). Muted helper styling, no new components. */}
        <p className="card-sub upload-hint">
          Upload a variance report, plus a year-to-date GL and detailed budget. You can
          upload less — a current-month GL, or no budget — but the variance commentary
          will be more limited.
        </p>

        {notice && <p className="upload-notice" role="status">{notice}</p>}

        {hasFiles && (
          <div className="upload-groups">
            <div className="upload-group">
              <div className="upload-group-label">Base Variance Report</div>
              {baseReport ? (
                <div className="chips">
                  <Chip file={baseReport} role="baseReport" extraction={extractions[fileKey(baseReport)]} onRemove={removeBase} />
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
                    <Chip key={`${f.name}-${i}`} file={f} role="supportingFile" extraction={extractions[fileKey(f)]} onRemove={() => removeSupport(i)} />
                  ))}
                </div>
              ) : (
                <p className="upload-group-empty">No supporting files yet.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
