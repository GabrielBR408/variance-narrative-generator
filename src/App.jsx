import React, { useState, useEffect, useRef } from 'react'
import SourceFiles from './components/SourceFiles.jsx'
import StylePanel from './components/StylePanel.jsx'
import VarianceDetail from './components/VarianceDetail.jsx'
import GeneratePanel from './components/GeneratePanel.jsx'
import ResultPanel from './components/ResultPanel.jsx'
import { classifyFile } from './lib/classify.js'
import { extractFile } from './lib/extract/extract.js'
import { extractionReadiness } from './lib/generateState.js'
import { enrichNarrative } from './lib/enrich/index.js'

// Stable in-memory key for a File. Same name+size+mtime ⇒ same extraction, so
// we never re-open a file we've already read this session.
function fileKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`
}

// Compact, faithful view of a browser extraction to ship to /generate. We send
// only the normalized shape the variance engine reads — never the raw text or
// parser internals. Returns null when the file hasn't been extracted yet.
function slimExtraction(ex) {
  if (!ex) return null
  return {
    fileId: ex.fileId,
    fileName: ex.fileName,
    status: ex.status,
    confidence: ex.confidence,
    classification: ex.classification ? { type: ex.classification.type } : null,
    normalized: ex.normalized || { rows: [], columns: [], accounts: [], dates: [], values: [] }
  }
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
  // A row is flagged when it crosses EITHER threshold (dollar OR percent) — the
  // variance engine's only rule (see src/lib/variance/thresholds.js). There is
  // no AND/OR toggle: the semantics are always OR, so the UI exposes only the
  // two threshold values. Default is $1,000 OR 10%, matching DEFAULT_THRESHOLDS.
  dollarThreshold: '1000',
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

  // Generate readiness (Phase 9C): the base report must have finished extracting
  // and produced usable content before a narrative can be generated. While the
  // base file is still being read, Generate stays disabled with a clear note.
  const baseExtraction = baseReport ? extractions[fileKey(baseReport)] : null
  const readiness = extractionReadiness({ hasBase: !!baseReport, baseExtraction })

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

    // Readiness gate (Phase 9C): no base, still extracting, or extraction failed.
    // The button is already disabled in these states; this guards programmatic
    // or race-y calls and surfaces the same friendly explanation.
    if (!readiness.ready) {
      setStatus('failure')
      setResult(null)
      setMessage(readiness.message)
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

    // Phase 9B: extraction is browser-first, so the normalized result the
    // browser already computed travels with the request. The server runs the
    // deterministic variance + narrative engines on it — no re-parsing.
    const baseExtraction = slimExtraction(extractions[fileKey(baseReport)])
    const supportingExtractions = supportingFiles
      .map((f) => slimExtraction(extractions[fileKey(f)]))
      .filter(Boolean)
    form.append(
      'extractions',
      JSON.stringify({ base: baseExtraction, supporting: supportingExtractions })
    )

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

      // Phase 15: enrich the server's base-only narrative with deterministic
      // evidence from the supporting files (which the browser already extracted).
      // With no supporting files or no confident match, this is a no-op and the
      // narrative is byte-identical to the server's.
      const narrative = enrichNarrative(data.narrative, { supporting: supportingExtractions })

      setResult({
        jobId: data.jobId,
        filesReceived: data.filesReceived,
        settingsReceived: data.settingsReceived,
        files: Array.isArray(data.files) ? data.files : [],
        extraction: data.extraction,
        variance: data.variance,
        narrative
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
        <GeneratePanel status={status} message={message} readiness={readiness} onGenerate={generate} />
        <ResultPanel status={status} result={result} />
      </div>
    </main>
  )
}
