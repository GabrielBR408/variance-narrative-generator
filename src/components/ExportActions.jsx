import React, { useState } from 'react'
import { narrativeToMarkdown, narrativeToClipboardText } from '../lib/export/markdown.js'
import { exportFileName } from '../lib/export/exportState.js'

// --- Export actions — Phase 10A -------------------------------------------
// Presentation only. Renders "Copy Narrative" and "Download Markdown" for a
// generated narrative. The exported text is built by the pure, tested
// src/lib/export/markdown.js — this component never authors or reformats prose.
// It only appears once a generation has succeeded (the parent gates on
// canExport), and degrades safely: a failed copy shows a retry-friendly note,
// never throws.
//
// Boundaries (Phase 10A): no storage, no document rendering, no network, no
// AI/LLM. The download is an in-memory Blob the browser saves locally.

// Best-effort clipboard write. Prefers the async Clipboard API (works in secure
// contexts incl. installed PWAs); falls back to a hidden textarea + execCommand
// for older/insecure contexts. Resolves on success, rejects otherwise.
async function writeClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text)
    return
  }
  // Fallback path for browsers without the async Clipboard API.
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } finally {
    document.body.removeChild(ta)
  }
  if (!ok) throw new Error('Copy command was rejected.')
}

// Trigger a local download of the Markdown as a .md file. Object URL is revoked
// immediately after the click so nothing lingers in memory.
function downloadMarkdown(narrative) {
  const md = narrativeToMarkdown(narrative)
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = exportFileName(narrative)
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const COPY_LABEL = {
  idle: 'Copy Narrative',
  copied: 'Copied ✓',
  error: 'Copy failed — try again'
}

export default function ExportActions({ narrative }) {
  const [copyState, setCopyState] = useState('idle') // idle | copied | error

  async function handleCopy() {
    try {
      await writeClipboard(narrativeToClipboardText(narrative))
      setCopyState('copied')
    } catch {
      setCopyState('error')
    }
  }

  return (
    <div className="export" aria-live="polite">
      <div className="export-actions">
        <button
          type="button"
          className="export-btn"
          onClick={handleCopy}
          // Reset feedback the moment the user moves to act again.
          onMouseEnter={() => copyState !== 'idle' && setCopyState('idle')}
        >
          {COPY_LABEL[copyState]}
        </button>
        <button
          type="button"
          className="export-btn export-btn--secondary"
          onClick={() => downloadMarkdown(narrative)}
        >
          Download Markdown
        </button>
      </div>
      {copyState !== 'idle' && (
        <p
          className={`export-msg export-msg--${copyState === 'error' ? 'error' : 'ok'}`}
          role={copyState === 'error' ? 'alert' : 'status'}
        >
          {copyState === 'error'
            ? 'Could not copy to the clipboard. You can still download the Markdown.'
            : 'Narrative copied to your clipboard.'}
        </p>
      )}
    </div>
  )
}
