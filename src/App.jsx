import React, { useState, useEffect, useRef } from 'react'
import SourceFiles from './components/SourceFiles.jsx'
import StylePanel from './components/StylePanel.jsx'
import VarianceDetail from './components/VarianceDetail.jsx'
import GeneratePanel from './components/GeneratePanel.jsx'
import ResultPanel from './components/ResultPanel.jsx'
import { classifyFile } from './lib/classify.js'
import { extractFile } from './lib/extract/extract.js'

// Stable in-memory key for a File. Same name+size+mtime ⇒ same extraction, so
// we never re-open a file we've already read this session.
function fileKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`
}

const DEFAULT_STYLE = {
  audience: 'Owner',
  reportStyle: 'Executive',
  tone: 'Neutral',
  length: 'Standard',
  learnFromUploads: false,
  notes: ''
}
const DEFAULT_VARIANCE = {
  thresholdLogic: 'AND',
  dollarThreshold: '10000',
  percentThreshold: '10',
  narrativeDetail: 'Standard',
  include: { glResearch: true, suggestedCauses: true, questions: true, priorComparison: true },
  ignore: { zeroVariances: true, smallRepeatItems: true }
}

export default function App() {
  // Upload state (isolated slice)
  const [baseReport, setBaseReport] = useState(null)
  const [supportingFiles, setSupportingFiles] = useState([])
  // Settings state (isolated slices)
  const [style, setStyle] = useState(DEFAULT_STYLE)
  const [variance, setVariance] = useState(DEFAULT_VARIANCE)
  // Generation state (isolated slice)
  const [status, setStatus] = useState('idle') // idle | preparing | sending | success | failure
  const [result, setResult] = useState(null)
  const [message, setMessage] = useState('')

  // Extraction state (Phase 7, isolated slice). Map fileKey → extraction
  // result. In memory only; discarded with the session, never persisted.
  const [extractions, setExtractions] = useState({})
  const startedRef = useRef(new Set()) // keys already sent to the extractor

  const busy = status === 'preparing' || status === 'sending'

  // Extraction pipeline: classify (Phase 6) → extract → normalize → preview.
  // Runs whenever the uploaded files change. Each file is opened at most once;
  // removed files are pruned so their content is released.
  useEffect(() => {
    const current = []
    if (baseReport) current.push({ file: baseReport, role: 'baseReport' })
    supportingFiles.forEach((f) => current.push({ file: f, role: 'supportingFile' }))
    const keys = new Set(current.map(({ file }) => fileKey(file)))

    // Drop extractions for files that are no longer present.
    setExtractions((prev) => {
      let changed = false
      const next = {}
      for (const k of Object.keys(prev)) {
        if (keys.has(k)) next[k] = prev[k]
        else changed = true
      }
      return changed ? next : prev
    })
    for (const k of [...startedRef.current]) if (!keys.has(k)) startedRef.current.delete(k)

    // Kick off extraction for any newly added file.
    current.forEach(({ file, role }) => {
      const id = fileKey(file)
      if (startedRef.current.has(id)) return
      startedRef.current.add(id)

      const classification = classifyFile({ name: file.name, role })
      setExtractions((prev) => ({
        ...prev,
        [id]: { fileId: id, fileName: file.name, classification, status: 'pending' }
      }))

      extractFile({ file, fileId: id, classification })
        .then((res) => setExtractions((prev) => (id in prev ? { ...prev, [id]: res } : prev)))
        .catch(() =>
          setExtractions((prev) =>
            id in prev
              ? {
                  ...prev,
                  [id]: { fileId: id, fileName: file.name, classification, status: 'error', message: 'Something went wrong while reading this file.', confidence: 0 }
                }
              : prev
          )
        )
    })
  }, [baseReport, supportingFiles])

  async function generate() {
    if (busy) return // prevent duplicate submits

    // Required-field check: a base file must exist before anything is sent.
    if (!baseReport) {
      setStatus('failure')
      setResult(null)
      setMessage('Add a base variance report before generating.')
      return
    }

    // Preparing: assemble one multipart request carrying the actual file
    // bytes. No interpretation, no extraction, no validation beyond the
    // required base file above.
    setStatus('preparing')
    setMessage('')
    setResult(null)

    const { notes, ...styleSettings } = style
    const form = new FormData()
    form.append('baseReport', baseReport) // real File object
    supportingFiles.forEach((f) => form.append('supportingFiles', f)) // real File objects
    form.append('style', JSON.stringify(styleSettings))
    form.append('variance', JSON.stringify(variance))
    form.append('notes', notes || '')

    // Sending. Do not set Content-Type — the browser adds the multipart
    // boundary automatically.
    setStatus('sending')
    try {
      const res = await fetch('/generate', { method: 'POST', body: form })

      let data
      try {
        data = await res.json()
      } catch {
        throw new Error('The server returned an unexpected response.')
      }

      if (!res.ok || !data || data.success !== true || !data.narrative) {
        throw new Error((data && data.error) || 'Generation could not be completed. Try again.')
      }

      setResult({
        jobId: data.jobId,
        filesReceived: data.filesReceived,
        settingsReceived: data.settingsReceived,
        files: Array.isArray(data.files) ? data.files : [],
        summary: data.narrative.summary
      })
      setStatus('success')
    } catch (err) {
      setStatus('failure')
      setMessage(err.message || 'Something went wrong. Try again.')
    }
  }

  return (
    <main className="page">
      <header className="masthead">
        <h1>Variance Narrative Generator</h1>
      </header>
      <div className="workflow">
        <SourceFiles
          baseReport={baseReport}
          setBaseReport={setBaseReport}
          supportingFiles={supportingFiles}
          setSupportingFiles={setSupportingFiles}
          extractions={extractions}
          fileKey={fileKey}
        />
        <StylePanel style={style} setStyle={setStyle} />
        <VarianceDetail variance={variance} setVariance={setVariance} />
        <GeneratePanel status={status} busy={busy} message={message} onGenerate={generate} />
        <ResultPanel status={status} result={result} />
      </div>
    </main>
  )
}
