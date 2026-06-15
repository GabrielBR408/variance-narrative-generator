import React, { useState } from 'react'
import { narrativeToMarkdown, narrativeToClipboardText } from '../lib/export/markdown.js'
import { narrativeToDocxBlob } from '../lib/export/docx.js'
import { exportFileName, docxFileName } from '../lib/export/exportState.js'

// --- Export actions — Phase 10A (Copy + Markdown) / Phase 11 (DOCX) --------
// Presentation only. Renders "Copy Narrative", "Download Markdown", and
// "Download DOCX" for a generated narrative. The exported text/structure is
// built by the pure, tested src/lib/export/{markdown,docx}.js — this component
// never authors or reformats prose. It only appears once a generation has
// succeeded (the parent gates on canExport), and degrades safely: a failed
// copy or DOCX build shows a retry-friendly note, never throws.
//
// Boundaries: browser-only. No storage, no server-side document generation, no
// network, no AI/LLM. Both downloads are in-memory Blobs the browser saves
// locally; nothing is persisted.

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

// Trigger a local download of an in-memory Blob. Object URL is revoked
// immediately after the click so nothing lingers in memory.
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Trigger a local download of the Markdown as a .md file.
function downloadMarkdown(narrative) {
  const md = narrativeToMarkdown(narrative)
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  downloadBlob(blob, exportFileName(narrative))
}

// Build the .docx in the browser and trigger a local download. Async because
// docx zips the document asynchronously; callers handle the rejection.
async function downloadDocx(narrative) {
  const blob = await narrativeToDocxBlob(narrative)
  downloadBlob(blob, docxFileName(narrative))
}

const COPY_LABEL = {
  idle: 'Copy Narrative',
  copied: 'Copied ✓',
  error: 'Copy failed — try again'
}

const DOCX_LABEL = {
  idle: 'Download DOCX',
  working: 'Preparing DOCX…',
  done: 'DOCX downloaded ✓',
  error: 'DOCX failed — try again'
}

export default function ExportActions({ narrative }) {
  const [copyState, setCopyState] = useState('idle') // idle | copied | error
  const [docxState, setDocxState] = useState('idle') // idle | working | done | error

  async function handleCopy() {
    try {
      await writeClipboard(narrativeToClipboardText(narrative))
      setCopyState('copied')
    } catch {
      setCopyState('error')
    }
  }

  async function handleDocx() {
    setDocxState('working')
    try {
      await downloadDocx(narrative)
      setDocxState('done')
    } catch {
      setDocxState('error')
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
        <button
          type="button"
          className="export-btn export-btn--secondary"
          onClick={handleDocx}
          disabled={docxState === 'working'}
          onMouseEnter={() => (docxState === 'done' || docxState === 'error') && setDocxState('idle')}
        >
          {DOCX_LABEL[docxState]}
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
      {(docxState === 'done' || docxState === 'error') && (
        <p
          className={`export-msg export-msg--${docxState === 'error' ? 'error' : 'ok'}`}
          role={docxState === 'error' ? 'alert' : 'status'}
        >
          {docxState === 'error'
            ? 'Could not build the Word document. You can still copy or download the Markdown.'
            : 'Word document downloaded.'}
        </p>
      )}
    </div>
  )
}
