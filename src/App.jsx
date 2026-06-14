import React, { useState } from 'react'
import SourceFiles from './components/SourceFiles.jsx'
import StylePanel from './components/StylePanel.jsx'
import VarianceDetail from './components/VarianceDetail.jsx'
import GeneratePanel from './components/GeneratePanel.jsx'
import ResultPanel from './components/ResultPanel.jsx'

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

  const busy = status === 'preparing' || status === 'sending'

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
        />
        <StylePanel style={style} setStyle={setStyle} />
        <VarianceDetail variance={variance} setVariance={setVariance} />
        <GeneratePanel status={status} busy={busy} message={message} onGenerate={generate} />
        <ResultPanel status={status} result={result} />
      </div>
    </main>
  )
}
