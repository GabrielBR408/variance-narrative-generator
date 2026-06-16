import React, { useState, useEffect, useRef, useMemo } from 'react'
import SourceFiles from './components/SourceFiles.jsx'
import StylePanel from './components/StylePanel.jsx'
import VarianceDetail from './components/VarianceDetail.jsx'
import GeneratePanel from './components/GeneratePanel.jsx'
import ResultPanel from './components/ResultPanel.jsx'
import { classifyFile } from './lib/classify.js'
import { extractFile } from './lib/extract/extract.js'
import {
  extractionReadiness,
  resultFreshness,
  shouldDiscardResult,
  pendingSupportingCount
} from './lib/generateState.js'
import { enrichNarrative } from './lib/enrich/index.js'
import { clientGenerate } from './lib/clientGenerate.js'
import { DEFAULT_COMMENTARY_DETAIL, commentaryModeFromStyle } from './lib/enrich/commentaryMode.js'
import { enrichmentDiagnostic } from './lib/enrichmentDiagnostic.js'
import { computeVariance } from './lib/variance/index.js'
import { DEFAULT_THRESHOLDS, thresholdsFromSettings } from './lib/variance/thresholds.js'
import { generateNarrative } from './lib/narrative/index.js'
import { periodScopeAvailable, DEFAULT_PERIOD_SCOPE } from './lib/narrative/periodScope.js'

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

// Phase 22.2: only `commentaryDetail` affects output today. The remaining style
// fields are rendered disabled ("Coming soon") and kept here purely so those
// previews display a sensible default; "learn from uploads" and free-text notes
// were removed entirely (UI + state + request wiring).
const DEFAULT_STYLE = {
  audience: 'Owner',
  reportStyle: 'Executive',
  tone: 'Neutral',
  length: 'Standard',
  commentaryDetail: DEFAULT_COMMENTARY_DETAIL
}
const DEFAULT_VARIANCE = {
  // A row is flagged when it crosses EITHER threshold (dollar OR percent) — the
  // variance engine's only rule (see src/lib/variance/thresholds.js). There is
  // no AND/OR toggle: the semantics are always OR, so the UI exposes only the
  // two threshold values. Default is $1,000 OR 10%, matching DEFAULT_THRESHOLDS.
  // The include/ignore groups are rendered disabled ("Coming soon") — not yet
  // wired into the engine. ("Narrative Detail" was removed entirely.)
  dollarThreshold: '1000',
  percentThreshold: '10',
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
  // Period-scope selector (Phase 15.1). Only meaningful when the base report
  // carries both a Current and a YTD period; otherwise it is hidden and this
  // value stays a no-op. Default 'both' preserves current behavior byte-for-byte.
  const [periodScope, setPeriodScope] = useState(DEFAULT_PERIOD_SCOPE)
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

  // Period-scope availability (Phase 15.1): the selector is offered only when the
  // base report actually produces both a Current and a YTD period. Derived from
  // the same deterministic variance → narrative path the preview uses, so the
  // control appears exactly when there is a real choice to make.
  const periodScopeOffered = useMemo(() => {
    if (!baseExtraction || baseExtraction.status !== 'ok') return false
    const narrative = generateNarrative(computeVariance(baseExtraction, DEFAULT_THRESHOLDS))
    return periodScopeAvailable(narrative)
  }, [baseExtraction])

  // Phase 22.1: the live preview flags rows with the user's CURRENT thresholds —
  // the same numbers the generate path will use — so changing a threshold updates
  // the preview immediately, with no Generate. Memoized on the raw inputs so the
  // object identity only changes when a threshold actually changes.
  const previewThresholds = useMemo(
    () => thresholdsFromSettings(variance),
    [variance.dollarThreshold, variance.percentThreshold]
  )

  // Supporting extractions currently in memory (used for the "still processing"
  // warning and the file-set freshness snapshot).
  const supportingExtractionList = supportingFiles
    .map((f) => extractions[fileKey(f)])
    .filter(Boolean)
  const pendingSupporting = pendingSupportingCount(supportingExtractionList)

  // Phase 22.2/22.3: is the displayed result (and its exports) still in sync with
  // the current inputs? Compares the snapshot taken at generate time against the
  // live thresholds, commentary mode, and uploaded file set. Period scope is
  // deliberately excluded — it is applied live, so changing it never makes a
  // result stale.
  const freshness = useMemo(() => {
    if (!result || !result.settings) return { stale: false, changed: [] }
    return resultFreshness({
      generated: { ...result.settings, ...result.source },
      current: {
        amountThreshold: previewThresholds.amount,
        percentThreshold: previewThresholds.percent,
        commentaryMode: commentaryModeFromStyle(style),
        baseKey: baseReport ? fileKey(baseReport) : null,
        supportingKeys: supportingFiles.map(fileKey).sort()
      }
    })
  }, [result, previewThresholds, style, baseReport, supportingFiles])

  // Phase 22.3: a result with no base report cannot be valid — its source is
  // gone. Clear it (and its export availability) so nothing stale lingers.
  useEffect(() => {
    if (shouldDiscardResult({ hasBase: !!baseReport, hasResult: !!result })) {
      setResult(null)
      setStatus('idle')
      setMessage('')
    }
  }, [baseReport, result])

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

    const form = new FormData()
    form.append('baseReport', baseReport) // real File object
    supportingFiles.forEach((f) => form.append('supportingFiles', f)) // real File objects
    form.append('style', JSON.stringify(style))
    form.append('variance', JSON.stringify(variance))

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

    // Compact file metadata for the static fallback's response (mirrors what the
    // server reports back as `files`).
    const clientFiles = [
      { name: baseReport.name, size: baseReport.size, type: baseReport.type || '', role: 'baseReport' },
      ...supportingFiles.map((f) => ({ name: f.name, size: f.size, type: f.type || '', role: 'supportingFile' }))
    ]

    // Sending. Do not set Content-Type — the browser adds the multipart
    // boundary automatically.
    setStatus('sending')
    try {
      // Try the real /generate endpoint (present in dev/preview and any server
      // deploy). On a static host (e.g., GitHub Pages) there is no endpoint, so
      // the request yields no usable JSON — fall back to computing the SAME
      // response in-browser with the same pure pipeline. A server that responds
      // with a structured error is still authoritative (surfaced below).
      let data = null
      try {
        const res = await fetch('/generate', { method: 'POST', body: form })
        data = await res.json()
      } catch {
        data = clientGenerate({
          baseExtraction,
          files: clientFiles,
          thresholds: previewThresholds,
          settingsReceived: Boolean(style && variance)
        })
      }

      if (!data || data.success !== true || !data.narrative) {
        throw new Error((data && data.error) || 'Generation could not be completed. Try again.')
      }

      // Phase 15: enrich the server's base-only narrative with deterministic
      // evidence from the supporting files (which the browser already extracted).
      // With no supporting files or no confident match, this is a no-op and the
      // narrative is byte-identical to the server's.
      // Phase 21.3/21.4: commentary mode (Detailed is the default; Conservative
      // is still selectable). The chosen mode flows into the generated result
      // and the exports (which consume this enriched narrative).
      const mode = commentaryModeFromStyle(style)
      const narrative = enrichNarrative(data.narrative, { supporting: supportingExtractions, mode })

      // UI-only enrichment diagnostic (deterministic; reads counts only, never
      // amounts/rows). Tells the user whether GL enrichment actually ran.
      const diagnostic = enrichmentDiagnostic({
        extractions: supportingExtractions,
        narratives: [narrative]
      })

      setResult({
        jobId: data.jobId,
        filesReceived: data.filesReceived,
        settingsReceived: data.settingsReceived,
        files: Array.isArray(data.files) ? data.files : [],
        extraction: data.extraction,
        variance: data.variance,
        narrative,
        diagnostic,
        // Phase 22.2: snapshot the settings this result was generated with, so the
        // UI can warn when the live settings drift from it (period scope excluded —
        // it is applied live at render/export time, so it never makes a result stale).
        settings: {
          amountThreshold: previewThresholds.amount,
          percentThreshold: previewThresholds.percent,
          commentaryMode: mode
        },
        // Phase 22.3: snapshot the file set too (base + sorted supporting), so the
        // same freshness banner fires when files are added, removed, or replaced.
        source: {
          baseKey: fileKey(baseReport),
          supportingKeys: supportingFiles.map(fileKey).sort()
        }
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
          periodScope={periodScope}
          commentaryMode={commentaryModeFromStyle(style)}
          thresholds={previewThresholds}
        />
        <StylePanel style={style} setStyle={setStyle} />
        <VarianceDetail
          variance={variance}
          setVariance={setVariance}
          periodScope={periodScope}
          setPeriodScope={setPeriodScope}
          periodScopeOffered={periodScopeOffered}
        />
        <GeneratePanel
          status={status}
          message={message}
          readiness={readiness}
          pendingSupporting={pendingSupporting}
          onGenerate={generate}
        />
        <ResultPanel status={status} result={result} periodScope={periodScope} freshness={freshness} />
      </div>
    </main>
  )
}
