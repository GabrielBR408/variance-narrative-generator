import React, { useState, useRef, useEffect, useCallback, useId } from 'react'
import { track } from '../lib/track.js'
import { version, commit, shortCommit } from '../lib/buildInfo.js'

// --- Feedback widget -------------------------------------------------------
// A small, self-contained "Send feedback" affordance mounted inside the VNG app
// only (see src/App.jsx). A floating pill sits bottom-right — clear of the PWA
// update banner, which is pinned to the top of the page (see
// src/pwa/registerUpdate.js) — and opens a panel that renders as a full-width
// bottom sheet on narrow screens and a compact bottom-right card on desktop.
//
// On send it fires the existing analytics helper exactly like every other event
// (track('vng', 'feedback', …)); there is no new endpoint. The build stamp
// (version + commit) is attached automatically so a report is tied to the exact
// deploy it came from.
//
// Accessibility: Escape closes the panel, focus moves into the panel on open and
// back to the pill on close, the pill/chips/close carry aria-labels, and the
// slide animation is suppressed under prefers-reduced-motion (handled in CSS).

const TYPES = [
  { id: 'bug', label: "Something's broken" },
  { id: 'idea', label: 'Idea/request' },
  { id: 'other', label: 'Other' }
]

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false)
  // form | sending | success — a tiny state machine for the send flow.
  const [phase, setPhase] = useState('form')
  const [type, setType] = useState('bug')
  const [message, setMessage] = useState('')

  const pillRef = useRef(null)
  const textareaRef = useRef(null)
  const titleId = useId()

  // The path the user was on when they opened the panel — shown on the receipt
  // line and sent with the event. Captured live so it reflects the current view.
  const path = typeof window !== 'undefined' ? window.location.pathname : '/'

  const resetForm = useCallback(() => {
    setPhase('form')
    setType('bug')
    setMessage('')
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    resetForm()
    // Return focus to the pill so keyboard users land where they started.
    if (pillRef.current) pillRef.current.focus()
  }, [resetForm])

  // Escape closes the panel from anywhere inside it.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  // Move focus into the panel (the message field) when the form appears.
  useEffect(() => {
    if (open && phase === 'form' && textareaRef.current) textareaRef.current.focus()
  }, [open, phase])

  const canSend = phase === 'form' && message.trim().length > 0

  function handleSend() {
    if (!canSend) return
    setPhase('sending')
    // Same call shape as every other event — no new endpoint, no schema change.
    track('vng', 'feedback', {
      feedback_type: type,
      message: message.trim().slice(0, 2000),
      app: 'vng',
      version,
      commit,
      screen: window.location.pathname
    })
    // track() is fire-and-forget; a brief sending state, then confirmation.
    setTimeout(() => setPhase('success'), 350)
  }

  return (
    <div className="feedback-widget">
      {!open && (
        <button
          ref={pillRef}
          type="button"
          className="feedback-pill"
          aria-label="Send feedback"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <span className="feedback-pill-icon" aria-hidden="true">💬</span>
          Feedback
        </button>
      )}

      {open && (
        <div
          className="feedback-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
        >
          <div className="feedback-panel-head">
            <h2 id={titleId} className="feedback-panel-title">Send feedback</h2>
            <button
              type="button"
              className="feedback-close"
              aria-label="Close feedback"
              onClick={close}
            >
              ×
            </button>
          </div>

          {phase === 'success' ? (
            <div className="feedback-success" role="status">
              <p className="feedback-success-msg">Thanks — feedback sent.</p>
              <p className="feedback-success-tag">
                Tagged to v{version} ({shortCommit})
              </p>
              <div className="feedback-actions">
                <button type="button" className="feedback-secondary" onClick={resetForm}>
                  Send another
                </button>
                <button type="button" className="feedback-send" onClick={close}>
                  Close
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="feedback-types" role="group" aria-label="Feedback type">
                {TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`feedback-chip${type === t.id ? ' feedback-chip--active' : ''}`}
                    aria-label={t.label}
                    aria-pressed={type === t.id}
                    disabled={phase === 'sending'}
                    onClick={() => setType(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <textarea
                ref={textareaRef}
                className="feedback-message"
                placeholder="What's on your mind?"
                aria-label="Feedback message"
                maxLength={2000}
                value={message}
                disabled={phase === 'sending'}
                onChange={(e) => setMessage(e.target.value)}
              />

              <p className="feedback-receipt">
                <span className="feedback-receipt-label">Attached automatically</span>
                <span className="feedback-receipt-value">
                  vng · v{version} · {shortCommit} · {path}
                </span>
              </p>

              <div className="feedback-actions">
                <button
                  type="button"
                  className="feedback-send"
                  disabled={!canSend}
                  aria-busy={phase === 'sending'}
                  onClick={handleSend}
                >
                  {phase === 'sending' ? 'Sending…' : 'Send'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
