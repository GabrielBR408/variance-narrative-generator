import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import SourceFiles from './components/SourceFiles.jsx'
import StylePanel from './components/StylePanel.jsx'
import VarianceDetail from './components/VarianceDetail.jsx'
import GeneratePanel from './components/GeneratePanel.jsx'
import ResultPanel from './components/ResultPanel.jsx'
import DisclosureModal from './components/DisclosureModal.jsx'
import PrivacyModal from './components/PrivacyModal.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import UploadGuidance from './components/UploadGuidance.jsx'
import PreviewBasis from './components/PreviewBasis.jsx'
import ExtractionPreview from './components/ExtractionPreview.jsx'
import TruncationNotice from './components/TruncationNotice.jsx'
import VariancePreview from './components/VariancePreview.jsx'
import NarrativeSummary from './components/NarrativeSummary.jsx'
import {
  extractionReadiness,
  resultFreshness,
  shouldDiscardResult,
  shouldClearFailure,
  pendingSupportingCount,
  generateClickAction
} from './lib/generateState.js'
import { commentaryModeFromStyle } from './lib/enrich/commentaryMode.js'
import { computeVariance } from './lib/variance/index.js'
import { DEFAULT_THRESHOLDS, thresholdsFromSettings } from './lib/variance/thresholds.js'
import { generateNarrative } from './lib/narrative/index.js'
import { periodScopeAvailable, DEFAULT_PERIOD_SCOPE } from './lib/narrative/periodScope.js'
import { fileKey } from './lib/fileKey.js'
import {
  loadProfiles,
  saveProfiles,
  upsertProfile,
  removeProfile,
  matchProfile,
  rowsForMatch,
  cleanProfileName,
  appliedProfileNotice
} from './lib/profiles.js'
import { useExtraction } from './hooks/useExtraction.js'
import { useGenerate } from './hooks/useGenerate.js'
import chiefeoLogo from './assets/chiefeo-logo.png'
import { track } from './lib/track.js'
import FeedbackWidget from './components/FeedbackWidget.jsx'
import { APP_VERSION, COMMIT_SHA } from './lib/buildInfo.js'

// Phase 23: all five Style controls are active and shape the generated
// narrative. Report Style / Tone / Length / Dollar Value References become
// plain-English STYLE INSTRUCTIONS in the LLM prompt (server/llm.js); Abbreviate
// Dollar Values additionally drives a deterministic dollar-abbreviation pass on
// the finished narrative. (Audience and the old "Commentary detail" control were
// removed — UI, state, and request wiring.)
const DEFAULT_STYLE = {
  reportStyle: 'Detailed',
  tone: 'Neutral',
  length: 'Standard',
  abbreviateDollars: false,
  dollarReferences: 'Detail'
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
  // Analytics: fire once when the actual /vng app mounts. Empty deps so this
  // never re-fires on re-renders. This file only ever renders for the /vng
  // route (see src/main.jsx's pathname switch), so app_opened is never fired
  // for the hub landing or the proxied /downdriller /orgen paths.
  useEffect(() => {
    track('vng', 'app_opened')
  }, [])

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

  // UX-1: generation always runs in AI mode ("cited"). The AI disclosure is
  // acknowledged once per session; the ref survives re-renders.
  const [showLlmDisclosure, setShowLlmDisclosure] = useState(false)
  const llmAcknowledgedRef = useRef(false)

  // First-visit privacy & AI disclosure. Shown once per browser; acknowledgement
  // is persisted in localStorage so it never reappears on later visits. Reads are
  // wrapped because localStorage can throw (private mode / disabled storage) — if
  // it does, we simply don't show the modal rather than break the app.
  const PRIVACY_ACK_KEY = 'cheo:privacyDisclosureAck'
  const [showPrivacyDisclosure, setShowPrivacyDisclosure] = useState(() => {
    try {
      return localStorage.getItem(PRIVACY_ACK_KEY) !== '1'
    } catch {
      return false
    }
  })

  const handlePrivacyDisclosureAccept = useCallback(() => {
    try {
      localStorage.setItem(PRIVACY_ACK_KEY, '1')
    } catch {
      // Storage unavailable — the modal simply reappears next session.
    }
    setShowPrivacyDisclosure(false)
  }, [])

  // Per-property threshold profiles. All the logic (shape, persistence,
  // upsert/remove rules, the auto-match) lives in src/lib/profiles.js; App only
  // holds the list, the dropdown's selection, and the one-line notice shown
  // when a profile is auto-applied for an uploaded base report.
  const [profiles, setProfiles] = useState(() => loadProfiles())
  const [selectedProfileName, setSelectedProfileName] = useState('')
  const [profileNotice, setProfileNotice] = useState('')
  // Has the user hand-edited the Variance-Detail settings since the current
  // base was uploaded? Auto-apply must never clobber a manual edit, so the
  // wrapped setter below flips this and the base-change effect resets it.
  const varianceEditedRef = useRef(false)
  // The base fileKey we already ran (or deliberately skipped) auto-match for —
  // each base gets exactly one attempt, at extraction-complete time.
  const autoMatchedBaseRef = useRef(null)

  // Every MANUAL Variance-Detail change funnels through here (VarianceDetail
  // receives this as its setter): it marks the settings as user-edited for the
  // current base and drops the dropdown selection, since the thresholds no
  // longer necessarily mirror the selected profile. Applying a profile bypasses
  // this wrapper on purpose — it calls setVariance directly.
  const handleVarianceChange = useCallback((updater) => {
    varianceEditedRef.current = true
    setSelectedProfileName('')
    setProfileNotice('')
    setVariance(updater)
  }, [])

  // Apply a saved profile from the dropdown. Writes through setVariance — the
  // exact settings-change path typing uses — so previews and result freshness
  // react identically. An explicit choice also counts as a manual edit: a later
  // auto-match must not override it.
  const handleApplyProfile = useCallback(
    (name) => {
      varianceEditedRef.current = true
      setProfileNotice('')
      const key = cleanProfileName(name).toLowerCase()
      const profile = profiles.find((p) => p.name.toLowerCase() === key)
      if (!profile) {
        setSelectedProfileName('')
        return
      }
      setSelectedProfileName(profile.name)
      setVariance((prev) => ({ ...prev, ...profile.settings }))
    },
    [profiles]
  )

  // Save the CURRENT thresholds under a property name (add or overwrite).
  // Returns whether the save was accepted so the form knows to clear its input.
  const handleSaveProfile = useCallback(
    (name) => {
      const next = upsertProfile(profiles, name, variance)
      if (next === profiles) return false // rejected: blank name or profile cap
      setProfiles(next)
      saveProfiles(next)
      setSelectedProfileName(cleanProfileName(name))
      return true
    },
    [profiles, variance]
  )

  const handleDeleteProfile = useCallback(
    (name) => {
      const next = removeProfile(profiles, name)
      if (next === profiles) return
      setProfiles(next)
      saveProfiles(next)
      setSelectedProfileName((sel) =>
        sel.toLowerCase() === cleanProfileName(name).toLowerCase() ? '' : sel
      )
    },
    [profiles]
  )

  // Extraction pipeline (Phase 7): classify → extract → normalize → preview.
  // Owns the in-memory extraction map and re-runs as the uploaded files change.
  const extractions = useExtraction({ baseReport, supportingFiles })

  const busy = status === 'preparing' || status === 'sending'

  // Generate readiness (Phase 9C): the base report must have finished extracting
  // and produced usable content before a narrative can be generated. While the
  // base file is still being read, Generate stays disabled with a clear note.
  const baseExtraction = baseReport ? extractions[fileKey(baseReport)] : null
  const readiness = extractionReadiness({ hasBase: !!baseReport, baseExtraction })

  // A new base means a clean slate for auto-apply: the "user edited settings"
  // flag is scoped to the base it was edited under, and a stale "Applied
  // profile" notice must not describe a property that is no longer uploaded.
  // (Declared before the auto-apply effect so the reset wins within a commit.)
  const baseKey = baseReport ? fileKey(baseReport) : null
  const prevBaseKeyRef = useRef(baseKey)
  useEffect(() => {
    if (prevBaseKeyRef.current === baseKey) return
    prevBaseKeyRef.current = baseKey
    varianceEditedRef.current = false
    setProfileNotice('')
    if (!baseKey) autoMatchedBaseRef.current = null
  }, [baseKey])

  // Auto-select the right profile when a BASE file's extraction completes:
  // match its filename + leading rows (metadata rows carry the property name)
  // against the saved profiles — src/lib/profiles.js owns the whole rule. One
  // attempt per base, taken the moment extraction succeeds; skipped (not
  // deferred) mid-generation or once the user has hand-edited settings since
  // this base was uploaded, so auto-apply never clobbers deliberate input.
  useEffect(() => {
    if (!baseKey || !baseExtraction || baseExtraction.status !== 'ok') return
    if (autoMatchedBaseRef.current === baseKey) return
    autoMatchedBaseRef.current = baseKey
    if (busy || varianceEditedRef.current) return
    const hit = matchProfile(profiles, {
      fileName: baseExtraction.fileName,
      rows: rowsForMatch(baseExtraction)
    })
    if (!hit) return
    setSelectedProfileName(hit.name)
    setVariance((prev) => ({ ...prev, ...hit.settings }))
    setProfileNotice(appliedProfileNotice(hit.name))
  }, [baseKey, baseExtraction, busy, profiles])

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

  // Ordered extraction items (base first) that feed the live previews. This used
  // to live inside SourceFiles; it is lifted here so the previews can be rendered
  // inside the "Settings & instructions" panel while still reading the same
  // extraction map. Pure derivation — identical inputs, identical output.
  const previewItems = useMemo(() => {
    const ordered = []
    if (baseReport) ordered.push(baseReport)
    supportingFiles.forEach((f) => ordered.push(f))
    return ordered.map((f) => extractions[fileKey(f)]).filter(Boolean)
  }, [baseReport, supportingFiles, extractions])

  // Phase 22.2/22.3: is the displayed result (and its exports) still in sync with
  // the current inputs? Compares the snapshot taken at generate time against the
  // live thresholds, commentary mode, full effective style (every Style-panel
  // field changes the generated output), and uploaded file set. Period scope is
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
        reportStyle: style.reportStyle,
        tone: style.tone,
        length: style.length,
        abbreviateDollars: !!style.abbreviateDollars,
        dollarReferences: style.dollarReferences,
        baseKey: baseReport ? fileKey(baseReport) : null,
        supportingKeys: supportingFiles.map(fileKey).sort()
      }
    })
  }, [result, previewThresholds, style, baseReport, supportingFiles])

  // The Generate flow (assembles the request, runs the pipeline, enriches, and
  // snapshots settings). Lives in a hook but drives App's status/result/message.
  const generate = useGenerate({
    baseReport,
    supportingFiles,
    style,
    variance,
    extractions,
    previewThresholds,
    readiness,
    busy,
    setStatus,
    setResult,
    setMessage
  })

  // The first Generate click in a session opens the disclosure; generation runs
  // once it is acknowledged (and immediately on every later click). Plain
  // functions so they always close over the current generate()/state.
  function handleGenerateClick() {
    const action = generateClickAction({ acknowledged: llmAcknowledgedRef.current, busy })
    if (action === 'disclose') setShowLlmDisclosure(true)
    else if (action === 'generate') generate()
  }

  function handleLlmDisclosureAccept() {
    llmAcknowledgedRef.current = true
    setShowLlmDisclosure(false)
    generate()
  }

  const handleLlmDisclosureDismiss = useCallback(() => {
    setShowLlmDisclosure(false)
  }, [])

  // Phase 22.3: a result with no base report cannot be valid — its source is
  // gone. Clear it (and its export availability) so nothing stale lingers.
  useEffect(() => {
    if (shouldDiscardResult({ hasBase: !!baseReport, hasResult: !!result })) {
      setResult(null)
      setStatus('idle')
      setMessage('')
    }
  }, [baseReport, result])

  // A failure message describes the file set it failed on. Once the user
  // changes that set (swaps in a good file, removes the bad one), the old alert
  // would wrongly imply the new files are also bad — clear it back to idle.
  const fileSetKey = [baseReport ? fileKey(baseReport) : '', ...supportingFiles.map(fileKey).sort()].join('|')
  const prevFileSetKeyRef = useRef(fileSetKey)
  useEffect(() => {
    const filesChanged = prevFileSetKeyRef.current !== fileSetKey
    prevFileSetKeyRef.current = fileSetKey
    if (shouldClearFailure({ status, filesChanged })) {
      setStatus('idle')
      setMessage('')
    }
  }, [fileSetKey, status])

  // Coarse screen label attached to feedback reports — enough to tell whether
  // the user was still uploading, mid-generation, or looking at a result.
  const feedbackScreen = result && status === 'success' ? 'result' : busy ? 'generating' : 'upload'

  return (
    <main className="page">
      <a className="back-to-hub" href="https://chiefeotool.com/">← All Tools</a>
      <header className="masthead">
        <img className="brand-logo" src={chiefeoLogo} alt="ChiefEO" />
        <h1>Variance Narrative Generator</h1>
      </header>
      <p className="hero-line">
        Upload your variance report and year-to-date GL, and click Generate Narrative
      </p>
      <div className="workflow">
        {/* Default view: only the upload area + file confirmation. */}
        <SourceFiles
          baseReport={baseReport}
          setBaseReport={setBaseReport}
          supportingFiles={supportingFiles}
          setSupportingFiles={setSupportingFiles}
          extractions={extractions}
        />

        {/* Auto-applied property profile confirmation — same unobtrusive notice
            styling as the upload-routing line inside SourceFiles. */}
        {profileNotice && (
          <p className="upload-notice" role="status">{profileNotice}</p>
        )}

        {/* Prominent truncation warning: a file that exceeded the extractor's
            row cap had rows (and any variance in them) dropped. Rendered here —
            outside the collapsed settings panel — so it is always visible. */}
        <TruncationNotice items={previewItems} />

        {/* Everything else lives in one collapsible panel, closed on first load.
            Controls first (they drive generation), then the upload guidance and
            the live previews. All state stays lifted in App, so these work
            identically whether the panel is open or closed. */}
        <SettingsPanel>
          <StylePanel style={style} setStyle={setStyle} />
          <VarianceDetail
            variance={variance}
            setVariance={handleVarianceChange}
            periodScope={periodScope}
            setPeriodScope={setPeriodScope}
            periodScopeOffered={periodScopeOffered}
            profiles={profiles}
            selectedProfileName={selectedProfileName}
            onApplyProfile={handleApplyProfile}
            onSaveProfile={handleSaveProfile}
            onDeleteProfile={handleDeleteProfile}
          />
          <UploadGuidance />
          <PreviewBasis items={previewItems} />
          <ExtractionPreview items={previewItems} />
          <VariancePreview items={previewItems} thresholds={previewThresholds} />
          <NarrativeSummary
            items={previewItems}
            periodScope={periodScope}
            commentaryMode={commentaryModeFromStyle(style)}
            thresholds={previewThresholds}
            style={style}
          />
        </SettingsPanel>

        <GeneratePanel
          status={status}
          message={message}
          readiness={readiness}
          pendingSupporting={pendingSupporting}
          onGenerate={handleGenerateClick}
        />
        {showLlmDisclosure && (
          <DisclosureModal onAccept={handleLlmDisclosureAccept} onDismiss={handleLlmDisclosureDismiss} />
        )}
        <ResultPanel status={status} result={result} periodScope={periodScope} freshness={freshness} />
      </div>

      {showPrivacyDisclosure && <PrivacyModal onAccept={handlePrivacyDisclosureAccept} />}

      <footer className="site-footer">
        <p className="site-footer-line">
          AI-generated narratives may contain errors. Always verify figures against source documents before distribution.
        </p>
        <p className="site-footer-line site-footer-line--muted">
          &copy; 2026 GREVE, operating as ChiefEO. All rights reserved.
        </p>
        <p className="site-footer-line site-footer-line--muted">
          v{APP_VERSION} · build {COMMIT_SHA}
        </p>
      </footer>

      <FeedbackWidget screen={feedbackScreen} />
    </main>
  )
}
